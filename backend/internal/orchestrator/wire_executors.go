package orchestrator

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"backend/internal/archiver"
	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/downloader/video"
	"backend/internal/idgen"
	"backend/internal/infra"
	"backend/internal/orchestrator/executors"
	"backend/internal/sites"
	"backend/internal/sites/universal"
	"backend/internal/taskprogress"
	"backend/internal/titleparser"
)

// defaultGalleryImageConcurrent is the fallback when
// DownloadDefaults.GalleryImageConcurrent is zero (unconfigured).
const defaultGalleryImageConcurrent = 5

// defaultVideoMaxConcurrent is the fallback when
// DownloadDefaults.VideoMaxConcurrent is zero (unconfigured).
const defaultVideoMaxConcurrent = 2

// defaultTSegmentConcurrent is the fallback when
// DownloadDefaults.TSegmentConcurrent is zero (unconfigured). Mirrors
// the default in config.go so the gallery pipeline always has a sane
// TS-segment concurrency even when constructed without config.
const defaultTSegmentConcurrent = 10

// WireExecutors registers the four gallery executors (scrape, download,
// verify, extract) with actual production implementations, replacing
// the nil-callback "simulating success" behavior with real work via
// the SiteRegistry, DownloadManager, ContentVerifier, and Archiver.
// The database is used by the scrape executor to persist gallery
// metadata (title, protagonist, images, videos) after scraping.
//
// titleParser is used in the scrape pipeline to extract protagonist
// names from gallery titles when the site provider does not return one.
// progressEngine is used in the download pipeline to register expected
// files for fine-grained progress tracking. videoTracker is used by the
// video download pipeline for segment-level tracking (injected into the
// DownloadManager separately, but passed here for the gallery video path).
// dlDefaults provides multi-thread download configuration that is
// applied to every DownloadOptions constructed by the download executor.
func WireExecutors(reg *executors.Registry, siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, titleParser *titleparser.Parser, progressEngine *taskprogress.Engine, videoTracker *taskprogress.VideoProgressTracker, dataDir string, dlDefaults *downloader.DownloadDefaults) {
	reg.Register(newScrapeExecutor(siteReg, database, eventBus, titleParser))
	reg.Register(newDownloadExecutor(siteReg, database, eventBus, progressEngine, dataDir, dlDefaults))
	reg.Register(newVerifyExecutor(database))
	reg.Register(newExtractExecutor())
	// Sniff executor: routes M3U8 sniffing through the universal
	// scraper's headless-browser network interception. The callback
	// processes ScrapePage results by creating download tasks for each
	// discovered M3U8 URL and updating sniff_tasks statistics.
	reg.Register(executors.NewSniffExecutor(func(ctx context.Context, url string, siteID string) (int, error) {
		_ = siteID // site routing is implicit via universal scraper
		result, err := universal.ScrapePage(ctx, url)
		if err != nil {
			return 0, err
		}

		// Deduplicate M3U8 URLs between the selected URL and candidates
		seen := make(map[string]bool)
		var candidates []string
		if result.M3U8URL != "" {
			candidates = append(candidates, result.M3U8URL)
			seen[result.M3U8URL] = true
		}
		for _, c := range result.M3U8Candidates {
			if !seen[c.URL] {
				candidates = append(candidates, c.URL)
				seen[c.URL] = true
			}
		}

		totalFound := len(candidates)
		totalCreated := 0
		totalSkipped := 0

		for _, m3u8URL := range candidates {
			var existing int
			_ = database.QueryRow(ctx,
				"SELECT COUNT(*) FROM download_tasks WHERE url = ? OR m3u8_url = ?",
				m3u8URL, m3u8URL).Scan(&existing)
			if existing > 0 {
				totalSkipped++
				continue
			}

			seq := idgen.GenerateID()
			var taskID int
			insErr := database.QueryRow(ctx,
				`INSERT INTO download_tasks (url, m3u8_url, status, progress, file_path, format, priority, error_msg, site_id, seq)
				 VALUES (?, ?, 'pending', 0, '', 'mp4', 1, '', ?, ?)
				 RETURNING id`,
				m3u8URL, m3u8URL, siteID, seq).Scan(&taskID)
			if insErr != nil {
				totalSkipped++
				continue
			}
			totalCreated++

			if eventBus != nil {
				eventBus.Emit("task:created", map[string]any{
					"ID":       taskID,
					"URL":      m3u8URL,
					"M3U8URL":  m3u8URL,
					"Status":   "pending",
					"TaskType": "video",
					"SiteID":   siteID,
				})
			}
		}

		database.Exec(ctx,
			"UPDATE sniff_tasks SET total_found = ?, total_created = ?, total_skipped = ? WHERE url = ?",
			totalFound, totalCreated, totalSkipped, url)

		return totalCreated, nil
	}, eventBus))
	infra.NewLogger("WireExecutors").Info("Executors wired to production implementations")
}

// newScrapeExecutor builds a ScrapeExecutor whose providerFn routes the
// URL through the SiteRegistry to the correct GallerySiteProvider, then
// persists the scraped metadata (title, protagonist, tags, images, videos)
// to the galleries / gallery_images / gallery_videos tables.
// Uses ScrapeGalleryHTTP first (which handles multi-page pagination),
// falling back to ScrapeGallery (browser-based) if HTTP fails.
func newScrapeExecutor(siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, titleParser *titleparser.Parser) *executors.ScrapeExecutor {
	logger := infra.NewLogger("ScrapeExecutor")
	fn := func(ctx context.Context, pageURL string) (map[string]any, error) {
		provider, ok := siteReg.GetProviderByUrl(pageURL)
		if !ok {
			return nil, fmt.Errorf("no provider registered for URL: %s", pageURL)
		}
		galleryProvider, ok := provider.(sites.GallerySiteProvider)
		if !ok {
			return nil, fmt.Errorf("provider %s does not implement GallerySiteProvider", provider.SiteID())
		}

		// ── Phase 1: Quick HTTP metadata sniff ──
		// Fire a fast HTTP GET (5s timeout) to extract just the title
		// and protagonist. If successful, persist them immediately so
		// the frontend sees metadata within 1-2 seconds, even if the
		// full scrape takes 30+ seconds (chromedp fallback).
		//
		// This eliminates the "identifying with no metadata" UX problem:
		// users see the task title and model name right away, while
		// the full scrape (images, videos, multi-page traversal)
		// continues in the background.
		quickCtx, quickCancel := context.WithTimeout(ctx, 6*time.Second)
		quickMeta, quickErr := universal.QuickMetadataScrape(quickCtx, pageURL)
		quickCancel()
		if quickErr != nil {
			logger.Debug("Quick metadata scrape skipped (non-critical)",
				"url", pageURL, "error", quickErr.Error())
		}
		if quickMeta != nil && database != nil && (quickMeta.Title != "" || quickMeta.Protagonist != "") {
			// Resolve protagonist through the title parser if available.
			protagonist := quickMeta.Protagonist
			if titleParser != nil && quickMeta.Title != "" && protagonist == "" {
				if parseResult := titleParser.Parse(quickMeta.Title); parseResult != nil && parseResult.Protagonist != "" {
					protagonist = parseResult.Protagonist
				}
			}

			_, err := database.Exec(ctx,
				`UPDATE galleries SET
					title = CASE WHEN COALESCE(title, '') = '' THEN ?1 ELSE title END,
					protagonist = CASE WHEN COALESCE(protagonist, '') = '' THEN ?2 ELSE protagonist END,
					updated_at = CURRENT_TIMESTAMP
					WHERE source_url = ?3`,
				quickMeta.Title, protagonist, pageURL)
			if err != nil {
				logger.Warn("Failed to persist quick metadata", "url", pageURL, "error", err.Error())
			} else if quickMeta.Title != "" || protagonist != "" {
				logger.Info("Quick metadata persisted (Phase 1 complete)",
					"url", pageURL, "title", quickMeta.Title, "protagonist", protagonist)

				// Emit SSE events so the frontend updates immediately.
				if eventBus != nil {
					var gid int
					if qErr := database.QueryRow(ctx, `SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&gid); qErr == nil {
						eventBus.Emit("task:metadata", map[string]any{
							"taskId":       gid,
							"taskType":     "gallery",
							"GalleryTitle": quickMeta.Title,
							"Person":       protagonist,
							"ImageCount":   0,
							"VideoCount":   0,
						})
					}
				}
			}
		}

		// ── Phase 2: Full content scrape ──
		// Try HTTP scrape first (handles multi-page pagination), fall
		// back to browser-based scrape if HTTP fails.
		var result *sites.GalleryScrapeResult
		var err error
		if httpProvider, ok := provider.(interface {
			ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error)
		}); ok {
			result, err = httpProvider.ScrapeGalleryHTTP(ctx, pageURL)
			if err != nil {
				logger.Warn("HTTP scrape failed, falling back to browser", "url", pageURL, "error", err.Error())
				result, err = galleryProvider.ScrapeGallery(ctx, pageURL)
			}
		} else {
			result, err = galleryProvider.ScrapeGallery(ctx, pageURL)
		}
		if err != nil {
			return nil, fmt.Errorf("scrape gallery: %w", err)
		}

		// Always try the title parser first. When it matches a model
		// from the preset database, use the canonical database name
		// instead of the raw title text to avoid semantic ambiguity.
		// Only fall back to the site provider's extraction when the
		// parser does not find a protagonist.
		protagonist := result.Protagonist
		if titleParser != nil && result.Title != "" {
			if parseResult := titleParser.Parse(result.Title); parseResult != nil && parseResult.Protagonist != "" {
				protagonist = parseResult.Protagonist
				logger.Info("Title parser extracted protagonist",
					"url", pageURL, "title", result.Title,
					"protagonist", protagonist,
					"confidence", parseResult.Confidence)
			}
		}

		// Persist scraped metadata to the galleries table.
		if database != nil {
			tagsStr := strings.Join(result.Tags, ", ")
			description := result.Description
			if len(description) > 500 {
				description = description[:500]
			}

			// Parse expected image/video counts from the gallery title
			// (e.g. "62P1V" → 62 images, 1 video). The TS implementation
			// used parseTitleCount() for this — the Go migration had
			// ParseTitleCount() available but never called it, instead
			// storing the actual scraped count as "expected" (circular).
			// Now we use title-derived counts when available, falling
			// back to scraped counts when the title has no count pattern.
			titleCounts := downloader.ParseTitleCount(result.Title)
			expectedImages := titleCounts.ExpectedImages
			if expectedImages == 0 {
				expectedImages = result.ImageCount
			}
			expectedVideos := titleCounts.ExpectedVideos
			if expectedVideos == 0 {
				expectedVideos = result.VideoCount
			}

			_, err = database.Exec(ctx,
				`UPDATE galleries SET
					title = CASE WHEN ?1 != '' THEN ?1 ELSE title END,
					protagonist = CASE WHEN ?2 != '' THEN ?2 ELSE protagonist END,
					description = ?3,
					category = ?4, tags = ?5, cover_url = ?6,
					image_count = ?7, video_count = ?8, page_count = ?9,
					expected_image_count = ?10, expected_video_count = ?11,
					scraped_domain = ?12, status = 'scraped',
					scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
					WHERE source_url = ?13`,
				result.Title, protagonist, description,
				result.Category, tagsStr, result.CoverURL,
				result.ImageCount, result.VideoCount, result.PageCount,
				expectedImages, expectedVideos,
				result.ScrapedDomain, pageURL)
			if err != nil {
				logger.Warn("Failed to persist gallery metadata", "url", pageURL, "error", err.Error())
			} else {
				logger.Info("Gallery metadata persisted",
					"url", pageURL, "title", result.Title,
					"protagonist", protagonist,
					"images", result.ImageCount, "videos", result.VideoCount)

				// Emit task:progress so SSE clients see the gallery
				// transition from pending → scraped in real-time.
				// Also emit task:metadata with the freshly-scraped title,
				// protagonist, and image/video counts so the frontend
				// updates these fields without waiting for F5 refresh.
				if eventBus != nil {
					var gid int
					if qErr := database.QueryRow(ctx, `SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&gid); qErr == nil {
						eventBus.Emit("task:progress", map[string]any{
							"taskId":    gid,
							"taskType":  "gallery",
							"progress":  0,
							"completed": 0,
							"total":     0,
							"failed":    0,
							"status":    "scraped",
						})
						eventBus.Emit("task:metadata", map[string]any{
							"taskId":       gid,
							"taskType":     "gallery",
							"GalleryTitle": result.Title,
							"Person":       protagonist,
							"ImageCount":   result.ImageCount,
							"VideoCount":   result.VideoCount,
						})
					}
				}
			}

			// Look up the gallery ID for inserting images/videos.
			var galleryID int
			err = database.QueryRow(ctx,
				`SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&galleryID)
			if err == nil {
				// Use a transaction for batch INSERT to reduce I/O round-trips.
				// Without a tx, each INSERT auto-commits and fsyncs the WAL,
				// which is catastrophically slow for 100+ image galleries.
				tx, txErr := database.BeginTx(ctx)
				if txErr != nil {
					logger.Warn("Failed to begin batch insert tx, falling back to single inserts",
						"url", pageURL, "error", txErr.Error())
					// Fallback: single inserts without transaction.
					_, _ = database.Exec(ctx, `DELETE FROM gallery_images WHERE gallery_id = ?`, galleryID)
					_, _ = database.Exec(ctx, `DELETE FROM gallery_videos WHERE gallery_id = ?`, galleryID)
					for i, img := range result.Images {
						_, _ = database.Exec(ctx,
							`INSERT INTO gallery_images (gallery_id, url, file_name, page_index, order_index, status)
							 VALUES (?, ?, ?, ?, ?, 'pending')`,
							galleryID, img.URL, filepath.Base(img.URL), img.PageIndex, i)
					}
					for _, vid := range result.Videos {
						_, _ = database.Exec(ctx,
							`INSERT INTO gallery_videos (gallery_id, url, file_name, status)
							 VALUES (?, ?, ?, 'pending')`,
							galleryID, vid.URL, filepath.Base(vid.URL))
					}
				} else {
					defer tx.Rollback()
					// Clear any existing images/videos (handles re-scrape).
					_, _ = tx.ExecContext(ctx, `DELETE FROM gallery_images WHERE gallery_id = ?`, galleryID)
					_, _ = tx.ExecContext(ctx, `DELETE FROM gallery_videos WHERE gallery_id = ?`, galleryID)

					// Insert gallery images in batch within the transaction.
					for i, img := range result.Images {
						_, _ = tx.ExecContext(ctx,
							`INSERT INTO gallery_images (gallery_id, url, file_name, page_index, order_index, status)
							 VALUES (?, ?, ?, ?, ?, 'pending')`,
							galleryID, img.URL, filepath.Base(img.URL), img.PageIndex, i)
					}
					// Insert gallery videos in the same transaction.
					for _, vid := range result.Videos {
						_, _ = tx.ExecContext(ctx,
							`INSERT INTO gallery_videos (gallery_id, url, file_name, status)
							 VALUES (?, ?, ?, 'pending')`,
							galleryID, vid.URL, filepath.Base(vid.URL))
					}
					if commitErr := tx.Commit(); commitErr != nil {
						logger.Warn("Batch insert tx commit failed",
							"url", pageURL, "error", commitErr.Error())
					}
				}
				logger.Info("Gallery images/videos inserted",
					"galleryId", galleryID,
					"images", len(result.Images),
					"videos", len(result.Videos))
			}

			// Persist ZIP download info when the page has an OUO/mediafire
			// archive link. The TS implementation stored this in
			// gallery_download_infos so the download pipeline could skip
			// page-by-page scraping and download the high-quality ZIP.
			if result.ZipInfo != nil && result.ZipInfo.DownloadURL != "" && galleryID > 0 {
				downloadSource := downloader.DetectDownloadSource(result.ZipInfo.DownloadURL)
				ouoURL := ""
				if downloadSource == downloader.SourceOuo {
					ouoURL = result.ZipInfo.DownloadURL
				}

				// Upsert: insert or update if already exists (handles re-scrape).
				_, _ = database.Exec(ctx,
					`INSERT INTO gallery_download_infos
						(gallery_id, title, file_count, file_size_text, image_dimensions,
						 password, download_url, download_source, ouo_url, provider,
						 requires_login, requires_email, status)
					 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending')
					 ON CONFLICT (gallery_id) DO UPDATE SET
						title = EXCLUDED.title,
						download_url = EXCLUDED.download_url,
						download_source = EXCLUDED.download_source,
						ouo_url = EXCLUDED.ouo_url,
						status = 'pending',
						updated_at = CURRENT_TIMESTAMP`,
					galleryID,
					result.ZipInfo.Title,
					result.ZipInfo.FileCount,
					result.ZipInfo.FileSizeText,
					result.ZipInfo.ImageDimensions,
					result.ZipInfo.Password,
					result.ZipInfo.DownloadURL,
					downloadSource,
					ouoURL,
					result.ZipInfo.Provider,
					result.ZipInfo.RequiresLogin,
					result.ZipInfo.RequiresEmail,
				)
				logger.Info("ZIP download info persisted",
					"galleryId", galleryID,
					"downloadUrl", result.ZipInfo.DownloadURL,
					"source", downloadSource)
			}
		}

		return map[string]any{
			"title":       result.Title,
			"protagonist": protagonist,
			"imageCount":  result.ImageCount,
			"pageCount":   result.PageCount,
			"coverUrl":    result.CoverURL,
			"zipInfo":     result.ZipInfo,
		}, nil
	}
	return executors.NewScrapeExecutor(fn)
}

// newDownloadExecutor builds a DownloadExecutor whose downloadFn
// calls DownloadFileWithDomainFallback with stealth headers and
// atomic write semantics. When a galleryId is present in the node
// config, it switches to gallery batch download mode, reading all
// gallery_images from the database and downloading each one.
func newDownloadExecutor(siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, progressEngine *taskprogress.Engine, dataDir string, dlDefaults *downloader.DownloadDefaults) *executors.DownloadExecutor {
	logger := infra.NewLogger("GalleryDownloader")
	fn := func(ctx context.Context, url, savePath string, domains []string) error {
		opts := dlDefaults.ApplyTo(&downloader.DownloadOptions{
			Timeout: 0,
			Atomic:  true,
		})
		result := downloader.DownloadFileWithDomainFallback(ctx, url, savePath, opts)
		if !result.Success {
			if result.Error != nil {
				return result.Error
			}
			return fmt.Errorf("download failed: %s", savePath)
		}
		return nil
	}
	exe := executors.NewDownloadExecutor(fn)

	// Gallery batch download function: reads all gallery_images from
	// DB, downloads each to data/galleries/{title}/, and updates
	// status. Also downloads gallery_videos.
	galleryFn := func(ctx context.Context, galleryID int) error {
		// Fetch gallery record for title and save path.
		var title, sourceURL string
		err := database.QueryRow(ctx,
			`SELECT title, source_url FROM galleries WHERE id = ?`, galleryID).
			Scan(&title, &sourceURL)
		if err != nil {
			return fmt.Errorf("query gallery %d: %w", galleryID, err)
		}

		// Get site domains for CDN anti-hotlink Referer fallback.
		// These domains are passed to GalleryDownloadVideo so it can
		// try alternative Referer headers when the CDN rejects the
		// primary Referer (HTTP 403 anti-hotlink).
		var siteDomains []string
		if mod, ok := siteReg.GetModuleByUrl(sourceURL); ok {
			siteDomains = mod.Domains
		}

		// Create save directory: data/galleries/{title}/
		// Folder name comes exclusively from the database title field;
		// no numeric ID prefix is added.
		safeTitle := downloader.SanitizeFileName(title)
		if safeTitle == "" {
			safeTitle = fmt.Sprintf("gallery_%d", galleryID)
		}
		saveDir := filepath.Join(dataDir, "galleries", safeTitle)
		if err := os.MkdirAll(saveDir, 0755); err != nil {
			return fmt.Errorf("create save dir: %w", err)
		}

		// Update gallery save_path and status.
		_, _ = database.Exec(ctx,
			`UPDATE galleries SET save_path = ?, status = 'downloading', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			saveDir, galleryID)

		// Emit task:progress so SSE clients see the gallery
		// transition to downloading in real-time.
		if eventBus != nil {
			eventBus.Emit("task:progress", map[string]any{
				"taskId":    galleryID,
				"taskType":  "gallery",
				"progress":  0,
				"completed": 0,
				"total":     0,
				"failed":    0,
				"status":    "downloading",
			})
		}

		// ZIP download path: when the gallery has an archive download URL
		// (e.g. OUO/MediaFire/direct .zip), download the ZIP and extract
		// it directly instead of scraping page-by-page images. This
		// produces higher quality images from the original archive and
		// is significantly faster for large galleries. Ported from the TS
		// downloadAndExtractZip() implementation whose OUO resolution was
		// lost during the Go migration.
		if zipDownloaded := downloader.TryDownloadGalleryZip(ctx, database, galleryID, saveDir, logger, func(ctx context.Context, ouoURL string) (string, error) {
			return NewOuoOrchestrator().Resolve(ctx, ouoURL)
		}, *dlDefaults); zipDownloaded {
			logger.Info("Gallery ZIP download completed, skipping page-by-page image download",
				"galleryId", galleryID, "saveDir", saveDir)
			// Persist the archive size so the shelf size column shows the
			// gallery's total volume. The ZIP path previously wrote only
			// status='completed' and left total_size/downloaded_size at 0,
			// so ZIP-downloaded galleries always displayed "—" for size.
			var zipSize int64
			_ = database.QueryRow(ctx,
				`SELECT COALESCE(actual_size, 0) FROM gallery_download_infos WHERE gallery_id = ?`, galleryID).Scan(&zipSize)
			_, _ = database.Exec(ctx,
				`UPDATE galleries SET status = 'completed', downloaded_size = ?, total_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
				zipSize, zipSize, galleryID)
			// Emit task:completed for SSE clients.
			if eventBus != nil {
				eventBus.Emit("task:completed", map[string]any{
					"taskId":   galleryID,
					"taskType": "gallery",
				})
			}
			return nil
		}

		// Load any checkpointed progress for this gallery so retry resumes
		// from already-downloaded files instead of starting over. The
		// per-file statuses (FileIndex keyed by order_index) were persisted
		// by SaveProgress at the end of the previous attempt.
		if progressEngine != nil {
			_ = progressEngine.LoadProgress(ctx, database, galleryID)
		}

		// Fetch all pending gallery_images. After a smart retry (see
		// cleanupGalleryCache) only failed/missing images are reset to
		// pending; already-downloaded ones keep status='downloaded' and are
		// therefore skipped here — accurate continuation.
		rows, err := database.Query(ctx,
			`SELECT id, url, file_name, order_index FROM gallery_images WHERE gallery_id = ? AND status = 'pending' ORDER BY order_index`,
			galleryID)
		if err != nil {
			return fmt.Errorf("query gallery_images: %w", err)
		}
		type imgTask struct {
			id         int
			url        string
			fileName   string
			orderIndex int
		}
		var images []imgTask
		for rows.Next() {
			var t imgTask
			if err := rows.Scan(&t.id, &t.url, &t.fileName, &t.orderIndex); err != nil {
				continue
			}
			images = append(images, t)
		}
		rows.Close()

		logger.Info("Gallery batch download starting",
			"galleryId", galleryID, "images", len(images), "saveDir", saveDir)

		// Advance the download-phase state machine. Retry enters SCANNING
		// (checkpoint already loaded above) then IN_PROGRESS; a fresh
		// download goes straight to IN_PROGRESS.
		if progressEngine != nil {
			phase := progressEngine.GetPhase(galleryID)
			if phase == taskprogress.PhasePending || phase == taskprogress.PhaseFailed {
				_ = progressEngine.SetPhase(galleryID, taskprogress.PhaseScanning)
			}
			if progressEngine.GetPhase(galleryID) != taskprogress.PhaseComplete {
				_ = progressEngine.SetPhase(galleryID, taskprogress.PhaseInProgress)
			}
		}

		// Register expected files with the ProgressEngine for fine-grained
		// progress tracking. Each image gets a FileProgress entry keyed by
		// its stable order_index so checkpoint recovery aligns across
		// retries (previously the slice position was used, which shifts on
		// retry once some files are already downloaded).
		if progressEngine != nil && len(images) > 0 {
			fileProgress := make([]taskprogress.FileProgress, len(images))
			for i, img := range images {
				fileProgress[i] = taskprogress.FileProgress{
					FileIndex: img.orderIndex,
					FileType:  taskprogress.FileTypeImage,
					FileURL:   img.url,
					Status:    taskprogress.FilePending,
				}
			}
			progressEngine.RegisterFiles(galleryID, fileProgress)
		}

		// Concurrent image download via errgroup with configurable limit.
		// Ported from the TS runConcurrent(allTasks, concurrency) pattern
		// that was lost during the Go migration. Each image downloads
		// independently; partial failures are tolerated (the TS behavior
		// allowed individual image failures without aborting the batch).
		var (
			mu           sync.Mutex
			successCount int
			failedCount  int
			totalSize    int64
		)
		totalImages := len(images)

		galleryConcurrent := dlDefaults.GalleryImageConcurrent
		if galleryConcurrent <= 0 {
			galleryConcurrent = defaultGalleryImageConcurrent
		}
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(galleryConcurrent)

		// Query gallery videos before starting the progress ticker so
		// the ticker can include video counts in its progress
		// calculation. Previously the ticker only counted images,
		// causing "100% downloading" when images finished before videos.
		videoRows, err := database.Query(ctx,
			`SELECT id, url, file_name FROM gallery_videos WHERE gallery_id = ? AND status = 'pending'`,
			galleryID)
		videoDownloaded := 0
		videoFailed := 0
		type vidTask struct {
			id       int
			url      string
			fileName string
		}
		var videos []vidTask
		if err == nil {
			for videoRows.Next() {
				var v vidTask
				if err := videoRows.Scan(&v.id, &v.url, &v.fileName); err != nil {
					continue
				}
				videos = append(videos, v)
			}
			videoRows.Close()
		}

		// Defensive guard: if neither images nor videos are pending, this is
		// almost always a data-integrity problem (gallery_images/videos were
		// wiped, or the scrape phase never populated them) — NOT a legit
		// "everything already downloaded" case. Completing here would write a
		// fake completed with total_size=0 (size column shows "—"). Fail the
		// node instead so the DAG surfaces an actionable state and the
		// scrape/re-scrape path can repopulate the gallery.
		if len(images) == 0 && len(videos) == 0 {
			logger.Warn("Gallery download aborted: no pending images or videos",
				"galleryId", galleryID, "saveDir", saveDir)
			return fmt.Errorf("gallery %d has no pending images or videos to download (re-scrape required)", galleryID)
		}

		// Run video downloads in their own errgroup so they execute
		// concurrently with image downloads. Each video processes
		// independently; failures are tolerated (the TS behavior allowed
		// individual video failures without aborting the batch).
		var videoMu sync.Mutex

		// Per-video segment/merge progress so the overall gallery
		// progress can fold in TS segment counts and the merge step,
		// instead of counting each video as a single opaque unit.
		// Guarded by videoMu.
		type galVideoState struct {
			segTotal int
			segDone  int
			merged   bool
		}
		videoProgress := map[int]*galVideoState{}

		// aggregateVideo is the single source of truth for the video
		// side of the gallery progress calculation (avoid duplication &
		// drift). It returns:
		//   segTotals   - total known TS segment count across videos
		//   segDone     - total done (completed + failed) segments
		//   discovered  - videos whose segment count is known; each
		//                 contributes one merge unit to the denominator
		//   merged      - videos whose TS→MP4 merge finished
		// Caller MUST hold videoMu.
		aggregateVideo := func() (segTotals, segDone, discovered, merged int) {
			for _, st := range videoProgress {
				if st.segTotal > 0 {
					segTotals += st.segTotal
					discovered++
				}
				segDone += st.segDone
				if st.merged {
					merged++
				}
			}
			return
		}

		// Periodic progress reporter: emit task:progress every 2s so
		// the SSE-connected frontend can show real-time download progress
		// instead of staying at 0% until the entire batch finishes.
		// The payload also carries downloadedSize (accumulated bytes of
		// successfully downloaded images AND videos) so the frontend
		// size column updates live instead of only appearing after
		// completion.
		//
		// The progress calculation accounts for both images and videos.
		// Previously this only counted images, which caused progress to
		// reach 100% while videos were still downloading — the frontend
		// displayed a confusing "100% downloading" state.
		progressDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-progressDone:
					return
				case <-ticker.C:
					mu.Lock()
					imgDone := successCount + failedCount
					downloaded := totalSize
					imgFailed := failedCount
					mu.Unlock()
					videoMu.Lock()
					segTotals, segDone, discovered, merged := aggregateVideo()
					vidFailed := videoFailed
					videoMu.Unlock()
					// Denominator = images + known TS segments + one merge
					// unit per discovered video. Numerator = done images +
					// done segments + merged videos. This makes segment
					// counts drive the percentage (e.g. 10 imgs + 10 segs =>
					// 20 units) and folds the merge step into the tail.
					totalContent := totalImages + segTotals + discovered
					done := imgDone + segDone + merged
					pct := 0
					if totalContent > 0 {
						pct = done * 100 / totalContent
						if pct > 99 {
							pct = 99 // Cap at 99 until fully completed
						}
					}
					if eventBus != nil {
						eventBus.Emit("task:progress", map[string]any{
							"taskId":         galleryID,
							"taskType":       "gallery",
							"progress":       pct,
							"completed":      done,
							"total":          totalContent,
							"failed":         imgFailed + vidFailed,
							"status":         "downloading",
							"downloadedSize": downloaded,
						})
					}
				}
			}
		}()

		for _, img := range images {
			img := img       // capture loop variable
			orderIndex := img.orderIndex // stable key for progress engine
			g.Go(func() error {
				select {
				case <-gctx.Done():
					return gctx.Err()
				default:
				}

				localPath := filepath.Join(saveDir, img.fileName)
				opts := dlDefaults.ApplyTo(&downloader.DownloadOptions{
					Timeout: 60_000_000_000, // 60s per image
					Atomic:  true,
				})
				result := downloader.DownloadFileWithDomainFallback(gctx, img.url, localPath, opts)
				mu.Lock()
				defer mu.Unlock()
				if result.Success {
					_, _ = database.Exec(gctx,
						`UPDATE gallery_images SET status = 'downloaded', local_path = ?, file_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						localPath, result.FileSize, img.id)
					successCount++
					totalSize += result.FileSize
					// Update ProgressEngine with completed file status.
					if progressEngine != nil {
						progressEngine.UpdateFileStatus(galleryID, orderIndex,
							taskprogress.FileCompleted, localPath, result.FileSize, "")
					}
				} else {
					errMsg := ""
					if result.Error != nil {
						errMsg = result.Error.Error()
					}
					_, _ = database.Exec(gctx,
						`UPDATE gallery_images SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						errMsg, img.id)
					failedCount++
					logger.Warn("Image download failed", "galleryId", galleryID, "url", img.url, "error", errMsg)
					// Update ProgressEngine with failed file status.
					if progressEngine != nil {
						progressEngine.UpdateFileStatus(galleryID, orderIndex,
							taskprogress.FileFailed, "", 0, errMsg)
					}
				}
				return nil // tolerate individual image failures
			})
		}

		// Download gallery videos concurrently with image downloads.
		// Video downloads use their own errgroup so they run in parallel
		// with the image errgroup — both channels share the total download
		// slot but are independently concurrent. Each video is an M3U8
		// stream: segments are saved to data/galleries/{id}_title/video_{vid}/
		// and merged into an MP4 file.
		//
		// Video query, variable declarations (videoDownloaded,
		// videoFailed, videos, videoMu) and the progress ticker are
		// declared earlier in the function so the ticker can include
		// video counts in its progress calculation.
		videoG, videoGCtx := errgroup.WithContext(ctx)
		videoConcurrent := dlDefaults.VideoMaxConcurrent
		if videoConcurrent <= 0 {
			videoConcurrent = defaultVideoMaxConcurrent
		}
		videoG.SetLimit(videoConcurrent)

		for _, vid := range videos {
			vid := vid
			videoG.Go(func() error {
				// Register this video's segment/merge state up front so the
				// progress callback can update it asynchronously.
				videoMu.Lock()
				st := &galVideoState{}
				videoProgress[vid.id] = st
				videoMu.Unlock()

				vidSaveDir := filepath.Join(saveDir, fmt.Sprintf("video_%d", vid.id))
				if mkdirErr := os.MkdirAll(vidSaveDir, 0755); mkdirErr != nil {
					logger.Warn("Failed to create video save dir", "vid", vid.id, "error", mkdirErr.Error())
					_, _ = database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						mkdirErr.Error(), vid.id)
					videoMu.Lock()
					videoFailed++
					videoMu.Unlock()
					return nil // Tolerate individual video failure
				}
				outputPath := filepath.Join(vidSaveDir, vid.fileName)
				if !strings.HasSuffix(strings.ToLower(outputPath), ".mp4") {
					outputPath += ".mp4"
				}

				// Decode MacCMS-encoded URLs before passing to the downloader.
				// MacCMS encodes M3U8 URLs as base64(url_encode(actual_url)).
				// The independent video pipeline decodes in taskLoaderFn; the
				// gallery pipeline decodes here to ensure parity.
				decodedURL := universal.DecodeMacCMSURL(vid.url)

				// Per-video timeout (10 min) prevents hanging M3U8 segment
				// downloads from blocking the errgroup indefinitely. The timeout
				// is scoped to each video so one slow video doesn't cancel others.
				videoCtx, videoCancel := context.WithTimeout(videoGCtx, 10*time.Minute)

				// TS-segment concurrency for this gallery video. Now sourced
				// from DownloadDefaults (config: TS_SEGMENT_CONCURRENT) so it
				// is tunable at runtime like the independent video pipeline's
				// tsSegmentConcurrent, instead of a hardcoded 10.
				segConcurrent := dlDefaults.TSegmentConcurrent
				if segConcurrent <= 0 {
					segConcurrent = defaultTSegmentConcurrent
				}
				// Fold this video's TS segments and merge step into the
				// gallery-wide progress via the shared per-video state.
				downloadErr := video.GalleryDownloadVideo(
					videoCtx, decodedURL, vidSaveDir, outputPath, sourceURL, siteDomains,
					video.GalleryVideoOptions{
						SegmentConcurrent: segConcurrent,
						UseGPU:            dlDefaults.GPUTranscode,
						ForceGPUType:      dlDefaults.ForceGPUType,
						OnProgress: func(ev video.GalleryVideoProgressEvent) {
							videoMu.Lock()
							if ev.SegmentsTotal > 0 {
								st.segTotal = ev.SegmentsTotal
							}
							if ev.SegmentsDone > 0 {
								st.segDone = ev.SegmentsDone
							}
							if ev.Merged {
								st.merged = true
							}
							videoMu.Unlock()
						},
					})
				videoCancel()
				if downloadErr != nil {
					logger.Warn("Gallery video download failed", "vid", vid.id, "url", vid.url, "error", downloadErr.Error())
					_, _ = database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						downloadErr.Error(), vid.id)
					videoMu.Lock()
					videoFailed++
					videoMu.Unlock()
				} else {
					// Probe the output MP4 for metadata (file size, duration,
					// resolution) so the shelf can display them. This mirrors
					// the independent video pipeline's probe step — previously
					// only local_path was written, leaving file_size/duration/
					// resolution at their zero defaults.
					var fileSize int64
					if info, statErr := os.Stat(outputPath); statErr == nil {
						fileSize = info.Size()
					}
					probeCtx, probeCancel := context.WithTimeout(context.Background(), 15*time.Second)
					durationSeconds, _ := video.ProbeDuration(probeCtx, outputPath)
					resolution, _ := video.ProbeResolution(probeCtx, outputPath)
					probeCancel()
					durationMinutes := math.Round(durationSeconds/60*10) / 10
					_, _ = database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'downloaded', local_path = ?, file_size = ?, duration = ?, resolution = ?, format = 'mp4', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						outputPath, fileSize, durationMinutes, resolution, vid.id)

					// Add the video file size to the gallery's total
					// downloaded_size. Previously this was missing — only
					// image file sizes were accumulated into totalSize,
					// causing the shelf size column to under-report the
					// total downloaded bytes for galleries with videos.
					//
					// We lock the shared mu (not videoMu) because totalSize
					// is protected by mu and is read later for the final
					// DB update and progress emission.
					mu.Lock()
					totalSize += fileSize
					mu.Unlock()

					// Clean up the segments directory to reclaim disk space.
					// The TS segment files are intermediate artifacts that
					// are no longer needed after the MP4 transcoding
					// succeeds. Failing to clean up leaves potentially
					// hundreds of MB of .ts files on disk, inflating the
					// gallery folder size significantly.
					segDir := filepath.Join(vidSaveDir, "segments")
					if rmErr := os.RemoveAll(segDir); rmErr != nil {
						logger.Warn("Failed to clean up video segments dir",
							"vid", vid.id, "path", segDir, "error", rmErr.Error())
					}

					videoMu.Lock()
					videoDownloaded++
					videoMu.Unlock()
				}
				return nil
			})
		}

		// Wait for image downloads to complete.
		var imgErr error
		if waitImgErr := g.Wait(); waitImgErr != nil && waitImgErr != context.Canceled {
			logger.Warn("Image batch download interrupted", "galleryId", galleryID, "error", waitImgErr.Error())
			imgErr = waitImgErr
		}

		// Wait for video downloads to complete.
		if vidWaitErr := videoG.Wait(); vidWaitErr != nil && vidWaitErr != context.Canceled {
			logger.Warn("Video batch download interrupted", "galleryId", galleryID, "error", vidWaitErr.Error())
		}

		_ = imgErr // Preserve for future use (partial completion reporting)

		// If the node's context was cancelled (e.g. the user paused the
		// DAG and the scheduler cancelled this node via CancelNode), abort
		// WITHOUT writing a terminal status. The DAG layer keeps the node
		// in PAUSED and a resume re-submits it; writing "completed" here
		// would desync the DB from the DAG and make the resume re-download
		// a gallery that already reports done.
		if ctxErr := ctx.Err(); ctxErr != nil {
			logger.Warn("Gallery download aborted by context cancellation",
				"galleryId", galleryID, "error", ctxErr.Error())
			return ctxErr
		}

		if len(videos) > 0 {
			logger.Info("Gallery videos processed",
				"galleryId", galleryID, "downloaded", videoDownloaded, "failed", videoFailed)
		}

		close(progressDone)

		// Final progress emission: always flush current state after
		// the batch finishes so the frontend displays the final count
		// even if the periodic ticker hasn't fired recently.
		//
		// The progress calculation must account for both images AND
		// videos. Previously this only counted images (successCount /
		// totalImages), which caused two bugs:
		//   1. When all images finished but a video was still
		//      downloading, progress was emitted as 100% with status
		//      "downloading" — the frontend displayed a confusing
		//      "100% downloading" state that never resolved.
		//   2. The video's file size was never added to totalSize,
		//      so the shelf size column under-reported the actual
		//      downloaded bytes.
		if eventBus != nil {
			// Recompute the video side from the authoritative per-video
			// state so the final event reflects segments + merge.
			videoMu.Lock()
			segTotals, segDone, discovered, merged := aggregateVideo()
			vidFailedFinal := videoFailed
			videoMu.Unlock()
			totalContent := totalImages + segTotals + discovered
			doneContent := successCount + segDone + merged
			finalPct := 100
			if doneContent < totalContent {
				finalPct = doneContent * 100 / totalContent
				if finalPct > 99 {
					finalPct = 99 // Cap at 99 until fully completed
				}
			}
			eventBus.Emit("task:progress", map[string]any{
				"taskId":         galleryID,
				"taskType":       "gallery",
				"progress":       finalPct,
				"completed":      doneContent,
				"total":          totalContent,
				"failed":         failedCount + vidFailedFinal,
				"status":         "downloading",
				"downloadedSize": totalSize,
			})
		}

	// Update gallery status. Both image and video outcomes contribute:
	// partial if any images or videos failed, completed only when all
	// expected content is present. This was a gap where video failures
	// were ignored and a gallery with failed videos was still marked
	// "completed".
	//
	// Also persist total_size (sum of all downloaded file sizes) so the
	// frontend size column can display the gallery's total volume after
	// completion. Previously only downloaded_size was written, leaving
	// total_size at its zero default — the frontend showed "—" for size.
	status := "completed"
	if successCount < len(images) || videoFailed > 0 {
		status = "partial"
	}
	_, _ = database.Exec(ctx,
		`UPDATE galleries SET status = ?, downloaded_size = ?, total_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		status, totalSize, totalSize, galleryID)

		// Advance the download-phase state machine to its terminal state
		// and persist the checkpoint so a future retry resumes accurately.
		if progressEngine != nil {
			if status == "completed" {
				_ = progressEngine.SetPhase(galleryID, taskprogress.PhaseComplete)
			} else {
				_ = progressEngine.SetPhase(galleryID, taskprogress.PhaseFailed)
			}
			_ = progressEngine.SaveProgress(ctx, database, galleryID)
		}

		// If the gallery has no local cover path yet, set it to the
		// first downloaded image so the shelf can display a thumbnail
		// without relying solely on the external cover_url redirect.
		var existingCoverPath string
		_ = database.QueryRow(ctx,
			"SELECT COALESCE(cover_local_path, '') FROM galleries WHERE id = ?", galleryID).Scan(&existingCoverPath)
		if existingCoverPath == "" && successCount > 0 {
			var firstImgPath string
			_ = database.QueryRow(ctx,
				`SELECT local_path FROM gallery_images WHERE gallery_id = ? AND status = 'downloaded' AND local_path != '' ORDER BY order_index LIMIT 1`,
				galleryID).Scan(&firstImgPath)
			if firstImgPath != "" {
				_, _ = database.Exec(ctx,
					`UPDATE galleries SET cover_local_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
					firstImgPath, galleryID)
			}
		}

		// Emit task:completed (or partial) so SSE clients see the
		// gallery finish in real-time without requiring a refresh.
		if eventBus != nil {
			eventBus.Emit("task:completed", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"status":   status,
			})
		}

		logger.Info("Gallery batch download completed",
			"galleryId", galleryID, "success", successCount, "total", len(images),
			"totalSize", totalSize, "status", status)

		return nil
	}

	return exe.WithGalleryDownload(galleryFn)
}

// newVerifyExecutor builds a VerifyExecutor whose verifyFn checks
// extracted content against the expected file counts and returns the
// (status, corrected, reason) triple that the orchestrator expects.
// When a galleryId is present in the node config, it switches to
// gallery-aware verification: querying the database for downloaded
// vs expected image counts, rather than checking the filesystem.
func newVerifyExecutor(database *db.Database) *executors.VerifyExecutor {
	logger := infra.NewLogger("VerifyExecutor")
	fn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
		// Gallery-aware verification: check DB for download status.
		if database != nil {
			if gid, ok := node.Config["galleryId"]; ok {
				var galleryID int
				switch v := gid.(type) {
				case int:
					galleryID = v
				case float64:
					galleryID = int(v)
				}
				if galleryID > 0 {
					return downloader.VerifyGallery(ctx, database, galleryID, logger)
				}
			}
		}

		// Filesystem-based verification (for non-gallery tasks).
		extractPath, _ := node.Config["extractPath"].(string)
		if extractPath == "" {
			extractPath, _ = node.Config["destPath"].(string)
		}
		var expectedImages, expectedVideos int
		if v, ok := node.Config["expectedImages"].(float64); ok {
			expectedImages = int(v)
		}
		if v, ok := node.Config["expectedVideos"].(float64); ok {
			expectedVideos = int(v)
		}

		// Skip verification for video tasks that have skipVerify flag.
		if skip, ok := node.Config["skipVerify"].(bool); ok && skip {
			return "passed", 0, ""
		}

		result := downloader.VerifyExtractedContent(extractPath, expectedImages, expectedVideos)
		if result.Matched {
			corrected := 0
			if result.ImageCount != expectedImages || result.VideoCount != expectedVideos {
				corrected = 1
			}
			return "passed", corrected, ""
		}
		return "needs_retry", 0, result.Reason
	}
	return executors.NewVerifyExecutor(fn)
}

// newExtractExecutor builds an ExtractExecutor whose extractFn
// delegates to the archiver package for ZIP/RAR extraction. For gallery
// pipeline nodes (which handle raw images/videos without an archive),
// and for nodes with an empty archive path, extraction is skipped
// silently rather than returning an error.
func newExtractExecutor() *executors.ExtractExecutor {
	fn := func(ctx context.Context, archivePath, destPath, password string) error {
		if archivePath == "" {
			return nil // gallery pipeline: no archive to extract
		}
		ext := filepath.Ext(archivePath)
		switch ext {
		case ".zip", ".cbz":
			return archiver.ExtractZip(archivePath, destPath, password)
		case ".rar":
			return fmt.Errorf("RAR extraction requires external tool: %s", archivePath)
		default:
			return nil // non-archive file: skip silently
		}
	}
	return executors.NewExtractExecutor(fn)
}
