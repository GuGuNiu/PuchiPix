package orchestrator

import (
	"context"
	"fmt"
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
	"backend/internal/infra"
	"backend/internal/orchestrator/executors"
	"backend/internal/sites"
	"backend/internal/taskprogress"
	"backend/internal/titleparser"
)

// galleryImageConcurrent controls the maximum number of simultaneous
// image downloads within a gallery batch. Ported from the TS
// gallery_image_concurrent setting (default 5) that was lost during
// the Go migration. This limit is independent of the TS segment
// download concurrency (ts_segment_concurrent, default 50), preserving
// the dual-channel design where image and video concurrency do not
// compete for the same pool.
const galleryImageConcurrent = 5

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
func WireExecutors(reg *executors.Registry, siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, titleParser *titleparser.Parser, progressEngine *taskprogress.Engine, videoTracker *taskprogress.VideoProgressTracker) {
	reg.Register(newScrapeExecutor(siteReg, database, eventBus, titleParser))
	reg.Register(newDownloadExecutor(siteReg, database, eventBus, progressEngine))
	reg.Register(newVerifyExecutor(database))
	reg.Register(newExtractExecutor())
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

		// If the site provider did not extract a protagonist name,
		// use the title parser to extract it from the gallery title.
		// This bridges the gap where some providers return raw titles
		// without model name extraction. The parser uses a model DB
		// loaded from embedded JSON resources to recognize known
		// coser names, game characters, and dual-person patterns.
		protagonist := result.Protagonist
		if protagonist == "" && titleParser != nil && result.Title != "" {
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
			// (e.g. "62P1V" �?62 images, 1 video). The TS implementation
			// used parseTitleCount() for this �?the Go migration had
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
					title = ?, protagonist = ?, description = ?,
					category = ?, tags = ?, cover_url = ?,
					image_count = ?, video_count = ?, page_count = ?,
					expected_image_count = ?, expected_video_count = ?,
					scraped_domain = ?, status = 'scraped',
					scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
					WHERE source_url = ?3`,
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
				// transition from pending �?scraped in real-time.
				if eventBus != nil {
					var gid int
					if qErr := database.QueryRow(ctx, `SELECT id FROM galleries WHERE source_url = ?`, pageURL).Scan(&gid); qErr == nil {
						eventBus.Emit("task:progress", map[string]any{
							"taskId":   gid,
							"taskType": "gallery",
							"progress": 0,
							"status":   "scraped",
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
func newDownloadExecutor(siteReg *sites.SiteRegistry, database *db.Database, eventBus *infra.EventBus, progressEngine *taskprogress.Engine) *executors.DownloadExecutor {
	logger := infra.NewLogger("GalleryDownloader")
	fn := func(ctx context.Context, url, savePath string, domains []string) error {
		opts := &downloader.DownloadOptions{
			Timeout: 0, // use default 30s
			Atomic:  true,
		}
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
	// DB, downloads each to data/galleries/{galleryId}/, and updates
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

		// Create save directory: data/galleries/{galleryId}_{title}/
		safeTitle := downloader.SanitizeFileName(title)
		if safeTitle == "" {
			safeTitle = fmt.Sprintf("gallery_%d", galleryID)
		}
		saveDir := filepath.Join("data", "galleries", fmt.Sprintf("%d_%s", galleryID, safeTitle))
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
				"taskId":   galleryID,
				"taskType": "gallery",
				"progress": 0,
				"status":   "downloading",
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
		}); zipDownloaded {
			logger.Info("Gallery ZIP download completed, skipping page-by-page image download",
				"galleryId", galleryID, "saveDir", saveDir)
			_, _ = database.Exec(ctx,
				`UPDATE galleries SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
				galleryID)
			// Emit task:completed for SSE clients.
			if eventBus != nil {
				eventBus.Emit("task:completed", map[string]any{
					"taskId":   galleryID,
					"taskType": "gallery",
				})
			}
			return nil
		}

		// Fetch all pending gallery_images.
		rows, err := database.Query(ctx,
			`SELECT id, url, file_name FROM gallery_images WHERE gallery_id = ? AND status = 'pending' ORDER BY order_index`,
			galleryID)
		if err != nil {
			return fmt.Errorf("query gallery_images: %w", err)
		}
		type imgTask struct {
			id       int
			url      string
			fileName string
		}
		var images []imgTask
		for rows.Next() {
			var t imgTask
			if err := rows.Scan(&t.id, &t.url, &t.fileName); err != nil {
				continue
			}
			images = append(images, t)
		}
		rows.Close()

		logger.Info("Gallery batch download starting",
			"galleryId", galleryID, "images", len(images), "saveDir", saveDir)

		// Register expected files with the ProgressEngine for fine-grained
		// progress tracking. This bridges the pipeline gap where the engine
		// was initialized and injected but never called from the download
		// pipeline. Each image gets a FileProgress entry so that
		// UpdateFileStatus can be called as downloads complete.
		if progressEngine != nil && len(images) > 0 {
			fileProgress := make([]taskprogress.FileProgress, len(images))
			for i, img := range images {
				fileProgress[i] = taskprogress.FileProgress{
					FileIndex: i,
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
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(galleryImageConcurrent)

		// Periodic progress reporter: emit task:progress every 2s so
		// the SSE-connected frontend can show real-time download progress
		// instead of staying at 0% until the entire batch finishes.
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
					done := successCount + failedCount
					pct := 0
					if totalImages > 0 {
						pct = done * 100 / totalImages
					}
					mu.Unlock()
					if eventBus != nil {
						eventBus.Emit("task:progress", map[string]any{
							"taskId":   galleryID,
							"taskType": "gallery",
							"progress": pct,
							"status":   "downloading",
						})
					}
				}
			}
		}()

		for imgIdx, img := range images {
			img := img     // capture loop variable
			imgIdx := imgIdx // capture loop variable for progress engine
			g.Go(func() error {
				select {
				case <-gctx.Done():
					return gctx.Err()
				default:
				}

				localPath := filepath.Join(saveDir, img.fileName)
				opts := &downloader.DownloadOptions{
					Timeout: 60_000_000_000, // 60s per image
					Atomic:  true,
				}
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
						progressEngine.UpdateFileStatus(galleryID, imgIdx,
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
						progressEngine.UpdateFileStatus(galleryID, imgIdx,
							taskprogress.FileFailed, "", 0, errMsg)
					}
				}
				return nil // tolerate individual image failures
			})
		}

		// Download gallery videos before waiting for image completion,
		// implementing the dual-channel design where image and video
		// downloads run in parallel with independent concurrency limits.
		videoRows, err := database.Query(ctx,
			`SELECT id, url, file_name FROM gallery_videos WHERE gallery_id = ? AND status = 'pending'`,
			galleryID)
		videoDownloaded := 0
		videoFailed := 0
		if err == nil {
			type vidTask struct {
				id       int
				url      string
				fileName string
			}
			var videos []vidTask
			for videoRows.Next() {
				var v vidTask
				if err := videoRows.Scan(&v.id, &v.url, &v.fileName); err != nil {
					continue
				}
				videos = append(videos, v)
			}
			videoRows.Close()

			// Download each gallery video as an M3U8 stream. Segments are
			// saved to data/galleries/{id}_title/video_{vid}/ and merged
			// into an MP4 file. This replaces the migration-era stub that
			// marked videos as "downloaded" without actually downloading.
			for _, vid := range videos {
				vidSaveDir := filepath.Join(saveDir, fmt.Sprintf("video_%d", vid.id))
				if mkdirErr := os.MkdirAll(vidSaveDir, 0755); mkdirErr != nil {
					logger.Warn("Failed to create video save dir", "vid", vid.id, "error", mkdirErr.Error())
					_, _ = database.Exec(ctx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						mkdirErr.Error(), vid.id)
					videoFailed++
					continue
				}
				outputPath := filepath.Join(vidSaveDir, vid.fileName)
				if !strings.HasSuffix(strings.ToLower(outputPath), ".mp4") {
					outputPath += ".mp4"
				}

				dlErr := video.GalleryDownloadVideo(ctx, vid.url, vidSaveDir, outputPath)
				if dlErr != nil {
					logger.Warn("Gallery video download failed", "vid", vid.id, "url", vid.url, "error", dlErr.Error())
					_, _ = database.Exec(ctx,
						`UPDATE gallery_videos SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						dlErr.Error(), vid.id)
					videoFailed++
				} else {
					_, _ = database.Exec(ctx,
						`UPDATE gallery_videos SET status = 'downloaded', local_path = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
						outputPath, vid.id)
					videoDownloaded++
				}
			}
			logger.Info("Gallery videos processed",
				"galleryId", galleryID, "downloaded", videoDownloaded, "failed", videoFailed)
		}

		// Wait for all image downloads to complete, then stop the progress
		// reporter and emit a final progress event so the frontend always
		// sees 100% (or partial) at completion.
		if imgErr := g.Wait(); imgErr != nil && imgErr != context.Canceled {
			logger.Warn("Image batch download interrupted", "galleryId", galleryID, "error", imgErr.Error())
		}
		close(progressDone)

		// Final progress emission: always flush current state after
		// the batch finishes so the frontend displays the final count
		// even if the periodic ticker hasn't fired recently.
		if eventBus != nil {
			finalPct := 100
			if successCount < totalImages {
				finalPct = successCount * 100 / totalImages
			}
			eventBus.Emit("task:progress", map[string]any{
				"taskId":   galleryID,
				"taskType": "gallery",
				"progress": finalPct,
				"status":   "downloading",
			})
		}

		// Update gallery status.
		status := "completed"
		if successCount < len(images) {
			status = "partial"
		}
		_, _ = database.Exec(ctx,
			`UPDATE galleries SET status = ?, downloaded_size = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			status, totalSize, galleryID)

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
