package orchestrator

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"backend/internal/archiver"
	"backend/internal/db"
	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/orchestrator/executors"
	"backend/internal/sites"
)

// WireExecutors registers the four gallery executors (scrape, download,
// verify, extract) with actual production implementations, replacing
// the nil-callback "simulating success" behavior with real work via
// the SiteRegistry, DownloadManager, ContentVerifier, and Archiver.
// The database is used by the scrape executor to persist gallery
// metadata (title, protagonist, images, videos) after scraping.
func WireExecutors(reg *executors.Registry, siteReg *sites.SiteRegistry, database *db.Database) {
	reg.Register(newScrapeExecutor(siteReg, database))
	reg.Register(newDownloadExecutor(siteReg, database))
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
func newScrapeExecutor(siteReg *sites.SiteRegistry, database *db.Database) *executors.ScrapeExecutor {
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
					title = $1, protagonist = $2, description = $3,
					category = $4, tags = $5, cover_url = $6,
					image_count = $7, video_count = $8, page_count = $9,
					expected_image_count = $10, expected_video_count = $11,
					scraped_domain = $12, status = 'scraped',
					scraped_at = NOW(), updated_at = NOW()
					WHERE source_url = $13`,
				result.Title, result.Protagonist, description,
				result.Category, tagsStr, result.CoverURL,
				result.ImageCount, result.VideoCount, result.PageCount,
				expectedImages, expectedVideos,
				result.ScrapedDomain, pageURL)
			if err != nil {
				logger.Warn("Failed to persist gallery metadata", "url", pageURL, "error", err.Error())
			} else {
				logger.Info("Gallery metadata persisted",
					"url", pageURL, "title", result.Title,
					"protagonist", result.Protagonist,
					"images", result.ImageCount, "videos", result.VideoCount)
			}

			// Look up the gallery ID for inserting images/videos.
			var galleryID int
			err = database.QueryRow(ctx,
				`SELECT id FROM galleries WHERE source_url = $1`, pageURL).Scan(&galleryID)
			if err == nil {
				// Clear any existing images/videos (handles re-scrape).
				_, _ = database.Exec(ctx, `DELETE FROM gallery_images WHERE gallery_id = $1`, galleryID)
				_, _ = database.Exec(ctx, `DELETE FROM gallery_videos WHERE gallery_id = $1`, galleryID)

				// Insert gallery images.
				for i, img := range result.Images {
					_, _ = database.Exec(ctx,
						`INSERT INTO gallery_images (gallery_id, url, file_name, page_index, order_index, status)
						 VALUES ($1, $2, $3, $4, $5, 'pending')`,
						galleryID, img.URL, filepath.Base(img.URL),
						img.PageIndex, i)
				}
				// Insert gallery videos.
				for _, vid := range result.Videos {
					_, _ = database.Exec(ctx,
						`INSERT INTO gallery_videos (gallery_id, url, file_name, status)
						 VALUES ($1, $2, $3, 'pending')`,
						galleryID, vid.URL, filepath.Base(vid.URL))
				}
				logger.Info("Gallery images/videos inserted",
					"galleryId", galleryID,
					"images", len(result.Images),
					"videos", len(result.Videos))
			}
		}

		return map[string]any{
			"title":       result.Title,
			"protagonist": result.Protagonist,
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
func newDownloadExecutor(siteReg *sites.SiteRegistry, database *db.Database) *executors.DownloadExecutor {
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
			`SELECT title, source_url FROM galleries WHERE id = $1`, galleryID).
			Scan(&title, &sourceURL)
		if err != nil {
			return fmt.Errorf("query gallery %d: %w", galleryID, err)
		}

		// Create save directory: data/galleries/{galleryId}_{title}/
		safeTitle := sanitizeFileName(title)
		if safeTitle == "" {
			safeTitle = fmt.Sprintf("gallery_%d", galleryID)
		}
		saveDir := filepath.Join("data", "galleries", fmt.Sprintf("%d_%s", galleryID, safeTitle))
		if err := os.MkdirAll(saveDir, 0755); err != nil {
			return fmt.Errorf("create save dir: %w", err)
		}

		// Update gallery save_path and status.
		_, _ = database.Exec(ctx,
			`UPDATE galleries SET save_path = $1, status = 'downloading', updated_at = NOW() WHERE id = $2`,
			saveDir, galleryID)

		// Fetch all pending gallery_images.
		rows, err := database.Query(ctx,
			`SELECT id, url, file_name FROM gallery_images WHERE gallery_id = $1 AND status = 'pending' ORDER BY order_index`,
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

		// Download each image.
		successCount := 0
		var totalSize int64
		for _, img := range images {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			localPath := filepath.Join(saveDir, img.fileName)
			opts := &downloader.DownloadOptions{
				Timeout: 60_000_000_000, // 60s per image
				Atomic:  true,
			}
			result := downloader.DownloadFileWithDomainFallback(ctx, img.url, localPath, opts)
			if result.Success {
				_, _ = database.Exec(ctx,
					`UPDATE gallery_images SET status = 'downloaded', local_path = $1, file_size = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $3`,
					localPath, result.FileSize, img.id)
				successCount++
				totalSize += result.FileSize
			} else {
				errMsg := ""
				if result.Error != nil {
					errMsg = result.Error.Error()
				}
				_, _ = database.Exec(ctx,
					`UPDATE gallery_images SET status = 'failed', error_msg = $1, updated_at = NOW() WHERE id = $2`,
					errMsg, img.id)
				logger.Warn("Image download failed", "galleryId", galleryID, "url", img.url, "error", errMsg)
			}
		}

		// Download gallery videos (if any).
		videoRows, err := database.Query(ctx,
			`SELECT id, url, file_name FROM gallery_videos WHERE gallery_id = $1 AND status = 'pending'`,
			galleryID)
		if err == nil {
			for videoRows.Next() {
				var vid int
				var vurl, vfile string
				if err := videoRows.Scan(&vid, &vurl, &vfile); err != nil {
					continue
				}
				// For M3U8 videos, just mark as downloaded (video download
				// is handled by the video pipeline, not gallery pipeline).
				_, _ = database.Exec(ctx,
					`UPDATE gallery_videos SET status = 'downloaded', updated_at = NOW() WHERE id = $1`, vid)
			}
			videoRows.Close()
		}

		// Update gallery status.
		status := "completed"
		if successCount < len(images) {
			status = "partial"
		}
		_, _ = database.Exec(ctx,
			`UPDATE galleries SET status = $1, downloaded_size = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $3`,
			status, totalSize, galleryID)

		logger.Info("Gallery batch download completed",
			"galleryId", galleryID, "success", successCount, "total", len(images),
			"totalSize", totalSize, "status", status)

		return nil
	}

	return exe.WithGalleryDownload(galleryFn)
}

// sanitizeFileName replaces characters that are invalid in file names.
func sanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	s := replacer.Replace(name)
	if len(s) > 80 {
		s = s[:80]
	}
	return s
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
					return verifyGallery(ctx, database, galleryID, logger)
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

// verifyGallery queries the database to check whether all gallery
// images were successfully downloaded. It returns (status, corrected, reason)
// following the same protocol as the filesystem verifier.
func verifyGallery(ctx context.Context, database *db.Database, galleryID int, logger *infra.Logger) (string, int, string) {
	var expectedImages, downloadedImages, failedImages int
	err := database.QueryRow(ctx,
		`SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE status = 'downloaded') AS downloaded,
			COUNT(*) FILTER (WHERE status = 'failed') AS failed
		FROM gallery_images WHERE gallery_id = $1`,
		galleryID).Scan(&expectedImages, &downloadedImages, &failedImages)
	if err != nil {
		logger.Warn("Gallery verify: failed to query image counts",
			"galleryId", galleryID, "error", err.Error())
		return "needs_retry", 0, fmt.Sprintf("verify query failed: %s", err.Error())
	}

	if expectedImages == 0 {
		return "needs_retry", 0, "no images found in gallery"
	}

	if downloadedImages == expectedImages {
		logger.Info("Gallery verify passed",
			"galleryId", galleryID,
			"expected", expectedImages,
			"downloaded", downloadedImages)
		return "passed", 0, ""
	}

	// Allow up to 2 missing images (tolerance for transient failures).
	missing := expectedImages - downloadedImages
	if missing <= 2 {
		logger.Info("Gallery verify passed with tolerance",
			"galleryId", galleryID,
			"expected", expectedImages,
			"downloaded", downloadedImages,
			"missing", missing)
		return "passed", 1, fmt.Sprintf("%d images missing (within tolerance)", missing)
	}

	reason := fmt.Sprintf("image mismatch: expected %d, downloaded %d, failed %d",
		expectedImages, downloadedImages, failedImages)
	logger.Warn("Gallery verify needs retry",
		"galleryId", galleryID,
		"expected", expectedImages,
		"downloaded", downloadedImages,
		"failed", failedImages)
	return "needs_retry", 0, reason
}

// newExtractExecutor builds an ExtractExecutor whose extractFn
// delegates to the archiver package for ZIP/RAR extraction.
func newExtractExecutor() *executors.ExtractExecutor {
	fn := func(ctx context.Context, archivePath, destPath, password string) error {
		ext := filepath.Ext(archivePath)
		switch ext {
		case ".zip", ".cbz":
			return archiver.ExtractZip(archivePath, destPath, password)
		case ".rar":
			return fmt.Errorf("RAR extraction requires external tool: %s", archivePath)
		default:
			return fmt.Errorf("unsupported archive format: %s", ext)
		}
	}
	return executors.NewExtractExecutor(fn)
}
