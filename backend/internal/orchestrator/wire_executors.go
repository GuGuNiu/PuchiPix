package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
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
	"backend/internal/xutil"
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

// WireExecutors registers the production scrape, download, verify and
// extract executors plus the M3U8 sniff executor with the registry.
//
// database lets the scrape executor persist gallery metadata after
// scraping. titleParser extracts protagonist names from gallery titles
// when the site provider does not return one. progressEngine registers
// expected files for fine-grained progress tracking, and videoTracker
// supplies segment-level tracking for the independent video pipeline.
// dlDefaults provides the multi-thread download configuration applied to
// every DownloadOptions built by the download executor.
func WireExecutors(reg *executors.Registry, siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, titleParser *titleparser.Parser, progressEngine *taskprogress.Engine, videoTracker *taskprogress.VideoProgressTracker, dataDir string, dlDefaults *downloader.DownloadDefaults) {
	reg.Register(newScrapeExecutor(siteReg, database, eventBus, titleParser))
	reg.Register(newDownloadExecutor(siteReg, database, eventBus, progressEngine, dataDir, dlDefaults))
	reg.Register(newVerifyExecutor(database))
	reg.Register(newExtractExecutor())
	// Sniffing routes through the universal scraper's headless-browser
	// network interception.
	reg.Register(executors.NewSniffExecutor(func(ctx context.Context, url string, siteID string) (int, error) {
		_ = siteID // site routing is implicit via universal scraper
		result, err := universal.ScrapePage(ctx, url)
		if err != nil {
			return 0, err
		}

		// The selected URL also appears in the candidate list, so dedupe
		// before creating tasks.
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
			if err := ctx.Err(); err != nil {
				return totalCreated, err
			}
			var existing int
			if err := database.QueryRow(ctx,
				"SELECT COUNT(*) FROM download_tasks WHERE url = ? OR m3u8_url = ?",
				m3u8URL, m3u8URL).Scan(&existing); err != nil {
				return totalCreated, err
			}
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
				return totalCreated, insErr
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

		if _, err := database.Exec(ctx,
			"UPDATE sniff_tasks SET total_found = ?, total_created = ?, total_skipped = ? WHERE url = ?",
			totalFound, totalCreated, totalSkipped, url); err != nil {
			return totalCreated, err
		}

		return totalCreated, nil
	}, eventBus))
	infra.NewLogger("WireExecutors").Info("Executors wired to production implementations")
}

func marshalMetadataList(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func normalizeGalleryMetadata(result *sites.GalleryScrapeResult, parser *titleparser.Parser) ([]string, []string) {
	if result == nil {
		return nil, nil
	}
	result.Title = xutil.CleanText(universal.CleanTitle(result.Title))
	result.Protagonist = xutil.CleanText(result.Protagonist)
	result.Description = xutil.CleanText(result.Description)
	result.Category = xutil.CleanText(result.Category)
	result.Tags = xutil.CleanTagList(result.Tags)
	result.GameCharacters = xutil.CleanActorList(result.GameCharacters)

	actors := xutil.CleanActorList([]string{result.Protagonist})
	gameCharacters := append([]string(nil), result.GameCharacters...)
	if parser != nil && result.Title != "" {
		parsed := parser.Parse(result.Title)
		if parsed != nil {
			if parsed.KnownMatch && len(parsed.RecognizedModels) > 0 {
				actors = xutil.CleanActorList(parsed.RecognizedModels)
			} else {
				actors = parser.NormalizeActors(actors, "")
			}
			gameCharacters = xutil.MergeMetadata(gameCharacters, parsed.GameCharacters)
		}
	}
	if len(actors) == 0 {
		result.Protagonist = ""
	} else {
		result.Protagonist = strings.Join(actors, ", ")
	}
	gameCharacters = xutil.CleanActorList(gameCharacters)
	excluded := append(append([]string(nil), actors...), gameCharacters...)
	excluded = append(excluded, result.Title)
	if parser != nil {
		result.Tags = parser.RemoveActorsFromTags(result.Tags, excluded)
	} else {
		result.Tags = xutil.RemoveMetadataValues(result.Tags, excluded)
	}
	return actors, gameCharacters
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

		// Fire a fast HTTP GET to extract only the title and protagonist,
		// then persist them immediately: the frontend shows metadata within a
		// second or two even though the full scrape can take much longer.
		quickCtx, quickCancel := context.WithTimeout(ctx, 6*time.Second)
		quickMeta, quickErr := universal.QuickMetadataScrape(quickCtx, pageURL)
		quickCancel()
		if quickErr != nil {
			logger.Debug("Quick metadata scrape skipped (non-critical)",
				"url", pageURL, "error", quickErr.Error())
		}
		if quickMeta != nil && database != nil && (quickMeta.Title != "" || quickMeta.Protagonist != "") {
			quickResult := &sites.GalleryScrapeResult{
				Title:       quickMeta.Title,
				Protagonist: quickMeta.Protagonist,
			}
			actors, _ := normalizeGalleryMetadata(quickResult, titleParser)
			protagonist := quickResult.Protagonist

			_, err := database.Exec(ctx,
				`UPDATE galleries SET
					title = CASE WHEN COALESCE(title, '') = '' THEN ?1 ELSE title END,
					protagonist = CASE WHEN COALESCE(protagonist, '') = '' THEN ?2 ELSE protagonist END,
					updated_at = CURRENT_TIMESTAMP
					WHERE source_url = ?3`,
				quickResult.Title, protagonist, pageURL)
			if err != nil {
				logger.Warn("Failed to persist quick metadata", "url", pageURL, "error", err.Error())
			} else if quickMeta.Title != "" || protagonist != "" {
				logger.Info("Quick metadata persisted (Phase 1 complete)",
					"url", pageURL, "title", quickMeta.Title, "protagonist", protagonist)

				// SSE clients see the new metadata without waiting for a
				// page refresh.
				if eventBus != nil {
					var gid int
					if qErr := database.QueryRow(ctx, `SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&gid); qErr == nil {
						eventBus.Emit("task:metadata", map[string]any{
							"taskId":       gid,
							"taskType":     "gallery",
							"GalleryTitle": quickResult.Title,
							"Person":       protagonist,
							"Tags":         quickResult.Tags,
							"Actors":       actors,
							"ImageCount":   0,
							"VideoCount":   0,
						})
					}
				}
			}
		}

		// ScrapeGalleryHTTP covers multi-page pagination; the browser path is
		// the fallback when it fails.
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

		actors, gameCharacters := normalizeGalleryMetadata(result, titleParser)
		protagonist := result.Protagonist
		if len(actors) > 0 {
			logger.Info("Gallery actor metadata normalized",
				"url", pageURL, "title", result.Title,
				"actors", actors)
		}

		if database != nil {
			tagsJSON := marshalMetadataList(result.Tags)
			gameCharactersJSON := marshalMetadataList(gameCharacters)
			description := result.Description
			if len([]rune(description)) > 500 {
				description = string([]rune(description)[:500])
			}

			// Title-derived counts (e.g. "62P1V" → 62 images, 1 video) come
			// from the title rather than the scrape, so they stay meaningful
			// even when the scrape is incomplete; scraped counts are the
			// fallback when the title carries no count pattern.
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
					category = ?4,
					tags = CASE WHEN ?5 != '[]' THEN ?5 ELSE tags END,
					game_characters = CASE WHEN ?6 != '[]' THEN ?6 ELSE game_characters END,
					cover_url = ?7,
					image_count = ?8, video_count = ?9, page_count = ?10,
					expected_image_count = ?11, expected_video_count = ?12,
					scraped_domain = ?13, status = 'scraped',
					scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
					WHERE source_url = ?14`,
				result.Title, protagonist, description,
				result.Category, tagsJSON, gameCharactersJSON, result.CoverURL,
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

				// SSE clients get the pending → scraped transition together
				// with the fresh title, protagonist and image/video counts,
				// so the frontend does not wait for a page refresh.
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
							"Tags":         result.Tags,
							"Actors":       actors,
							"ImageCount":   result.ImageCount,
							"VideoCount":   result.VideoCount,
						})
					}
				}
			}

			var galleryID int
			err = database.QueryRow(ctx,
				`SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&galleryID)
			if err == nil {
				// Batch the inserts in one transaction: each auto-commit
				// would fsync the WAL per image, which is far too slow for
				// galleries with 100+ images.
				tx, txErr := database.BeginTx(ctx)
				if txErr != nil {
					return nil, txErr
				}
				defer tx.Rollback()
				if _, err := tx.ExecContext(ctx, `DELETE FROM gallery_images WHERE gallery_id = ?`, galleryID); err != nil {
					return nil, err
				}
				if _, err := tx.ExecContext(ctx, `DELETE FROM gallery_videos WHERE gallery_id = ?`, galleryID); err != nil {
					return nil, err
				}

				for i, img := range result.Images {
					if _, err := tx.ExecContext(ctx,
						`INSERT INTO gallery_images (gallery_id, url, file_name, page_index, order_index, status)
						 VALUES (?, ?, ?, ?, ?, 'pending')`,
						galleryID, img.URL, filepath.Base(img.URL), img.PageIndex, i); err != nil {
						return nil, err
					}
				}
				for _, vid := range result.Videos {
					if _, err := tx.ExecContext(ctx,
						`INSERT INTO gallery_videos (gallery_id, url, file_name, status)
						 VALUES (?, ?, ?, 'pending')`,
						galleryID, vid.URL, filepath.Base(vid.URL)); err != nil {
						return nil, err
					}
				}
				if commitErr := tx.Commit(); commitErr != nil {
					return nil, commitErr
				}
				logger.Info("Gallery images/videos inserted",
					"galleryId", galleryID,
					"images", len(result.Images),
					"videos", len(result.Videos))
			}

			// Record the archive link in gallery_download_infos so the
			// download pipeline can fetch the high-quality ZIP instead of
			// crawling page by page.
			if result.ZipInfo != nil && result.ZipInfo.DownloadURL != "" && galleryID > 0 {
				downloadSource := downloader.DetectDownloadSource(result.ZipInfo.DownloadURL)
				ouoURL := ""
				if downloadSource == downloader.SourceOuo {
					ouoURL = result.ZipInfo.DownloadURL
				}

				if _, err := database.Exec(ctx,
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
				); err != nil {
					return nil, err
				}
				logger.Info("ZIP download info persisted",
					"galleryId", galleryID,
					"downloadUrl", result.ZipInfo.DownloadURL,
					"source", downloadSource)
			}
		}

		return map[string]any{
			"title":          result.Title,
			"protagonist":    protagonist,
			"tags":           result.Tags,
			"actors":         actors,
			"gameCharacters": gameCharacters,
			"imageCount":     result.ImageCount,
			"pageCount":      result.PageCount,
			"coverUrl":       result.CoverURL,
			"zipInfo":        result.ZipInfo,
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

	galleryFn := func(ctx context.Context, galleryID int) error {
		var title, sourceURL string
		err := database.QueryRow(ctx,
			`SELECT title, source_url FROM galleries WHERE id = ?`, galleryID).
			Scan(&title, &sourceURL)
		if err != nil {
			return fmt.Errorf("query gallery %d: %w", galleryID, err)
		}

		// Site domains enable the CDN anti-hotlink Referer fallback:
		// GalleryDownloadVideo retries alternative Referer headers when the
		// primary Referer is rejected with HTTP 403.
		var siteDomains []string
		if mod, ok := siteReg.GetModuleByUrl(sourceURL); ok {
			siteDomains = mod.Domains
		}

		safeTitle := downloader.SanitizeFileName(title)
		if safeTitle == "" {
			safeTitle = "gallery"
		}
		saveDir := filepath.Join(dataDir, "galleries", fmt.Sprintf("%s_%d", safeTitle, galleryID))
		if err := os.MkdirAll(saveDir, 0755); err != nil {
			return fmt.Errorf("create save dir: %w", err)
		}

		// The entity status is NOT written here: the node is already RUNNING
		// when this executor runs, and the statusSync callback has already
		// written "downloading" to the DB and emitted the matching
		// task:progress event, so a second write would create a competing
		// authority for the same state.
		_, _ = database.Exec(ctx,
			`UPDATE galleries SET save_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			saveDir, galleryID)

		// When the gallery has an archive URL (OUO/MediaFire/direct .zip),
		// download and extract it instead of fetching images page by page:
		// the archive holds the original quality and is much faster for
		// large galleries.
		if zipDownloaded := downloader.TryDownloadGalleryZip(ctx, database, galleryID, saveDir, logger, func(ctx context.Context, ouoURL string) (string, error) {
			return NewOuoOrchestrator().Resolve(ctx, ouoURL)
		}, *dlDefaults); zipDownloaded {
			logger.Info("Gallery ZIP download completed, skipping page-by-page image download",
				"galleryId", galleryID, "saveDir", saveDir)
			// Persist the archive size so the shelf size column shows the
			// gallery's total volume rather than an empty value.
			var zipSize int64
			_ = database.QueryRow(ctx,
				`SELECT COALESCE(actual_size, 0) FROM gallery_download_infos WHERE gallery_id = ?`, galleryID).Scan(&zipSize)
			_, _ = database.Exec(ctx,
				`UPDATE galleries SET status = 'completed', downloaded_size = ?, total_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
				zipSize, zipSize, galleryID)
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
				// Log rather than swallow: a scan failure silently drops pending images
				logger.Warn("Gallery batch download: image row scan failed",
					map[string]any{"galleryId": galleryID, "error": err.Error()})
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
		// retries; the slice position would shift once some files are
		// already downloaded.
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

		// Images download concurrently through an errgroup with a configurable
		// limit. Each image is independent, so a single failure does not abort
		// the batch.
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

		// Query gallery videos before the progress ticker starts so it can
		// fold video counts into its calculation; counting only images made
		// progress reach 100% while videos were still downloading.
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
					// Log rather than swallow: a scan failure silently drops pending videos
					logger.Warn("Gallery batch download: video row scan failed",
						map[string]any{"galleryId": galleryID, "error": err.Error()})
					continue
				}
				videos = append(videos, v)
			}
			videoRows.Close()
		} else {
			logger.Warn("Gallery batch download: video rows query failed",
				map[string]any{"galleryId": galleryID, "error": err.Error()})
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

		// Videos run in their own errgroup so they download concurrently with
		// images; a single video failure does not abort the batch.
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

		// aggregateVideo is the single source of truth for the video side
		// of the gallery progress calculation, so the ticker and the final
		// emission cannot drift apart. Caller must hold videoMu.
		//
		// It returns:
		//   - segTotals: known TS segment count across videos
		//   - segDone: done (completed + failed) segments
		//   - discovered: videos with a known segment count, each
		//     contributing one merge unit to the denominator
		//   - merged: videos whose TS-to-MP4 merge finished
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

		// Periodic progress reporter: emit task:progress every 2s so the
		// SSE-connected frontend shows real-time download progress instead
		// of staying at 0% until the entire batch finishes. The payload also
		// carries downloadedSize (accumulated bytes of successfully
		// downloaded images AND videos) so the frontend size column updates
		// live.
		progressDone := make(chan struct{})
		defer close(progressDone)
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
			img := img
			orderIndex := img.orderIndex // stable key for progress engine
			g.Go(func() error {
				select {
				case <-gctx.Done():
					return gctx.Err()
				default:
				}

				localPath := filepath.Join(saveDir, img.fileName)
				opts := dlDefaults.ApplyTo(&downloader.DownloadOptions{
					Timeout: 60_000_000_000,
					Atomic:  true,
				})
				result := downloader.DownloadFileWithDomainFallback(gctx, img.url, localPath, opts)
				mu.Lock()
				defer mu.Unlock()
				if result.Success {
					if _, dbErr := database.Exec(gctx,
						`UPDATE gallery_images SET status = 'downloaded', local_path = ?, file_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						localPath, result.FileSize, img.id); dbErr != nil {
						failedCount++
						if progressEngine != nil {
							progressEngine.UpdateFileStatus(galleryID, orderIndex,
								taskprogress.FileFailed, "", 0, dbErr.Error())
						}
						logger.Error("Failed to persist downloaded image", "galleryId", galleryID, "imageId", img.id, "error", dbErr.Error())
						return nil
					}
					successCount++
					totalSize += result.FileSize
					if progressEngine != nil {
						progressEngine.UpdateFileStatus(galleryID, orderIndex,
							taskprogress.FileCompleted, localPath, result.FileSize, "")
					}
				} else {
					errMsg := ""
					if result.Error != nil {
						errMsg = result.Error.Error()
					}
					if _, dbErr := database.Exec(gctx,
						`UPDATE gallery_images SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						errMsg, img.id); dbErr != nil {
						logger.Error("Failed to persist image failure", "galleryId", galleryID, "imageId", img.id, "error", dbErr.Error())
					}
					failedCount++
					logger.Warn("Image download failed", "galleryId", galleryID, "url", img.url, "error", errMsg)
					if progressEngine != nil {
						progressEngine.UpdateFileStatus(galleryID, orderIndex,
							taskprogress.FileFailed, "", 0, errMsg)
					}
				}
				return nil
			})
		}

		// Videos download in their own errgroup so they run in parallel with
		// the image errgroup; both share the total download slot but are
		// independently concurrent. Each video is an M3U8 stream whose
		// segments are saved to data/galleries/{id}_title/video_{vid}/ and
		// merged into an MP4 file. The video query, counters, videoMu and
		// the progress ticker are declared earlier so the ticker can fold
		// video counts into its calculation.
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
					if _, dbErr := database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						mkdirErr.Error(), vid.id); dbErr != nil {
						logger.Error("Failed to persist video mkdir failure", "vid", vid.id, "error", dbErr.Error())
					}
					videoMu.Lock()
					videoFailed++
					videoMu.Unlock()
					return nil
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

				// TS-segment concurrency comes from DownloadDefaults
				// (TS_SEGMENT_CONCURRENT) so it stays tunable at runtime,
				// like the independent video pipeline's tsSegmentConcurrent.
				segConcurrent := dlDefaults.TSegmentConcurrent
				if segConcurrent <= 0 {
					segConcurrent = defaultTSegmentConcurrent
				}
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
					if _, dbErr := database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						downloadErr.Error(), vid.id); dbErr != nil {
						logger.Error("Failed to persist video failure", "vid", vid.id, "error", dbErr.Error())
					}
					videoMu.Lock()
					videoFailed++
					videoMu.Unlock()
				} else {
					// Probe the output MP4 for file size, duration and
					// resolution so the shelf can display them.
					var fileSize int64
					if info, statErr := os.Stat(outputPath); statErr == nil {
						fileSize = info.Size()
					}
					probeCtx, probeCancel := context.WithTimeout(videoCtx, 15*time.Second)
					metadata, _ := video.ProbeVideoMetadata(probeCtx, outputPath)
					probeCancel()
					durationMinutes := math.Round(metadata.Duration/60*10) / 10
					if _, dbErr := database.Exec(videoGCtx,
						`UPDATE gallery_videos SET status = 'downloaded', local_path = ?, file_size = ?, duration = ?, resolution = ?, format = 'mp4', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						outputPath, fileSize, durationMinutes, metadata.Resolution, vid.id); dbErr != nil {
						videoMu.Lock()
						videoFailed++
						videoMu.Unlock()
						logger.Error("Failed to persist downloaded video", "vid", vid.id, "error", dbErr.Error())
						return nil
					}

					// The gallery's total_size must include video bytes,
					// otherwise the shelf size column under-reports galleries
					// that carry videos. totalSize is guarded by mu (not
					// videoMu) because the final DB update and the progress
					// emission read it.
					mu.Lock()
					totalSize += fileSize
					mu.Unlock()

					// Reclaim disk space: the TS segment files are
					// intermediate artifacts no longer needed once the MP4
					// transcode succeeded, and leaving them behind inflates
					// the gallery folder size by hundreds of MB.
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

		var imgErr error
		if waitImgErr := g.Wait(); waitImgErr != nil && waitImgErr != context.Canceled {
			logger.Warn("Image batch download interrupted", "galleryId", galleryID, "error", waitImgErr.Error())
			imgErr = waitImgErr
		}

		if vidWaitErr := videoG.Wait(); vidWaitErr != nil && vidWaitErr != context.Canceled {
			logger.Warn("Video batch download interrupted", "galleryId", galleryID, "error", vidWaitErr.Error())
		}

		_ = imgErr // Reserved for partial completion reporting

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

		// Always flush current state after the batch finishes so the
		// frontend displays the final count even if the periodic ticker
		// has not fired recently. The calculation must account for images
		// AND videos: counting only images let progress reach 100% while a
		// video was still downloading, and left the video's bytes out of
		// totalSize so the shelf size column under-reported the gallery.
		// The terminal status is pre-computed so both the final
		// task:progress event and the task:completed event carry it
		// instead of a hard-coded "downloading".
		status := "completed"
		if successCount < len(images) || videoFailed > 0 {
			status = "partial"
		}

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
				finalPct = 99
			}
		}

		// Both image and video outcomes contribute: partial if any image
		// or video failed, completed only when all expected content is
		// present. total_size is the sum of every downloaded file, not
		// only the images, so the shelf size column shows the gallery's
		// real volume after completion.
		if _, err := database.Exec(ctx,
			`UPDATE galleries SET status = ?, downloaded_size = ?, total_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			status, totalSize, totalSize, galleryID); err != nil {
			return err
		}

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
		if err := database.QueryRow(ctx,
			"SELECT COALESCE(cover_local_path, '') FROM galleries WHERE id = ?", galleryID).Scan(&existingCoverPath); err != nil {
			return err
		}
		if existingCoverPath == "" && successCount > 0 {
			var firstImgPath string
			if err := database.QueryRow(ctx,
				`SELECT local_path FROM gallery_images WHERE gallery_id = ? AND status = 'downloaded' AND local_path != '' ORDER BY order_index LIMIT 1`,
				galleryID).Scan(&firstImgPath); err != nil && err != sql.ErrNoRows {
				return err
			}
			if firstImgPath != "" {
				if _, err := database.Exec(ctx,
					`UPDATE galleries SET cover_local_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
					firstImgPath, galleryID); err != nil {
					return err
				}
			}
		}

		if eventBus != nil {
			eventBus.Emit("task:progress", map[string]any{
				"taskId":         galleryID,
				"taskType":       "gallery",
				"progress":       finalPct,
				"completed":      doneContent,
				"total":          totalContent,
				"failed":         failedCount + vidFailedFinal,
				"status":         status,
				"downloadedSize": totalSize,
			})
		}

		// Emit task:completed (or partial) so SSE clients see the gallery
		// finish in real time without requiring a refresh. The progress
		// field is included so the frontend can set the final progress
		// value atomically with the terminal status, preventing stale
		// task:progress values from overriding it.
		if eventBus != nil {
			videoMu.Lock()
			segTotals, segDone, discovered, merged := aggregateVideo()
			videoMu.Unlock()
			totalContent := totalImages + segTotals + discovered
			doneContent := successCount + segDone + merged
			completedPct := 100
			if doneContent < totalContent {
				completedPct = doneContent * 100 / totalContent
				if completedPct > 99 {
					completedPct = 99
				}
			}
			eventBus.Emit("task:completed", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"status":   status,
				"progress": completedPct,
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
// With a galleryId in the node config it verifies against the database
// (downloaded vs expected image counts) instead of the filesystem.
func newVerifyExecutor(database *db.Database) *executors.VerifyExecutor {
	logger := infra.NewLogger("VerifyExecutor")
	fn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
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
// delegates to the archiver package for ZIP/RAR extraction. Gallery
// pipeline nodes (raw images/videos, no archive) and nodes with an
// empty or non-archive path are skipped silently rather than failing.
func newExtractExecutor() *executors.ExtractExecutor {
	fn := func(ctx context.Context, archivePath, destPath, password string) error {
		if archivePath == "" {
			return nil
		}
		ext := filepath.Ext(archivePath)
		switch ext {
		case ".zip", ".cbz":
			return archiver.ExtractZip(archivePath, destPath, password)
		case ".rar":
			return fmt.Errorf("RAR extraction requires external tool: %s", archivePath)
		default:
			return nil
		}
	}
	return executors.NewExtractExecutor(fn)
}
