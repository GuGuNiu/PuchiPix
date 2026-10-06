package downloader

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"backend/internal/archiver"
	"backend/internal/db"
	"backend/internal/infra"
	"backend/internal/taskprogress"
)

// SanitizeFileName replaces invalid filename characters and truncates by
// rune count (not byte length) to avoid splitting multi-byte UTF-8 characters.
func SanitizeFileName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	s := replacer.Replace(name)
	if runes := []rune(s); len(runes) > 80 {
		s = string(runes[:80])
	}
	return strings.TrimSpace(s)
}

// ResolveOUOFn resolves an OUO short link to its direct download URL.
// Injected by the orchestrator to keep the downloader package free of
// orchestrator dependencies.
type ResolveOUOFn func(ctx context.Context, ouoURL string) (string, error)

// TryDownloadGalleryZip attempts to download and extract a ZIP archive when
// gallery_download_infos holds a valid download URL. Returns false when no
// archive URL exists or the download or extraction fails, letting the caller
// fall back to page-by-page image download.
func TryDownloadGalleryZip(ctx context.Context, database *db.Database, galleryID int, saveDir string, logger *infra.Logger, resolveOUO ResolveOUOFn, dlDefaults DownloadDefaults) bool {
	if database == nil {
		return false
	}
	var dlURL, password, downloadSource, ouoURL string
	var fileCount int
	err := database.QueryRow(ctx,
		`SELECT download_url, password, download_source, ouo_url, COALESCE(file_count, 0)
		 FROM gallery_download_infos WHERE gallery_id = ? AND status = 'pending'`,
		galleryID).Scan(&dlURL, &password, &downloadSource, &ouoURL, &fileCount)
	if err != nil || dlURL == "" {
		return false
	}

	logger.Info("ZIP download available, attempting archive download",
		"galleryId", galleryID, "source", downloadSource, "url", dlURL)

	// OUO short links resolve through the HTTP redirect chain; a link that
	// requires JavaScript interaction fails resolution and the caller falls
	// back to page-by-page image download.
	downloadURL := dlURL
	if downloadSource == "ouo" {
		if resolveOUO == nil {
			logger.Warn("OUO resolution not available, falling back to page-by-page download",
				"galleryId", galleryID, "url", dlURL)
			database.Exec(ctx,
				`UPDATE gallery_download_infos SET status = 'failed', updated_at = CURRENT_TIMESTAMP
				 WHERE gallery_id = ?`, galleryID)
			return false
		}
		resolved, resolveErr := resolveOUO(ctx, dlURL)
		if resolveErr != nil || resolved == dlURL {
			logger.Warn("OUO resolution failed, falling back to page-by-page download",
				"galleryId", galleryID, "url", dlURL, "error", resolveErr)
			// Mark as failed to prevent retrying the broken OUO link.
			database.Exec(ctx,
				`UPDATE gallery_download_infos SET status = 'failed', updated_at = CURRENT_TIMESTAMP
				 WHERE gallery_id = ?`, galleryID)
			return false
		}
		downloadURL = resolved
		_, _ = database.Exec(ctx,
			`UPDATE gallery_download_infos SET resolved_direct_url = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE gallery_id = ?`, resolved, galleryID)
		logger.Info("OUO link resolved", "galleryId", galleryID, "resolved", resolved)
	}

	zipFileName := fmt.Sprintf("gallery_%d.zip", galleryID)
	zipPath := filepath.Join(saveDir, zipFileName)
	opts := dlDefaults.ApplyTo(&DownloadOptions{
		Timeout: 3600_000_000_000,
		Atomic:  true,
	})
	result := DownloadFileWithDomainFallback(ctx, downloadURL, zipPath, opts)
	if !result.Success {
		errMsg := "download failed"
		if result.Error != nil {
			errMsg = result.Error.Error()
		}
		logger.Warn("ZIP download failed, falling back to page-by-page download",
			"galleryId", galleryID, "error", errMsg)
		database.Exec(ctx,
			`UPDATE gallery_download_infos SET status = 'failed', updated_at = CURRENT_TIMESTAMP
			 WHERE gallery_id = ?`, galleryID)
		return false
	}

	logger.Info("ZIP downloaded, extracting archive",
		"galleryId", galleryID, "size", result.FileSize, "path", zipPath)

	// Archive password comes from gallery_download_infos (extracted from the
	// download-info-box during page scraping).
	extractErr := archiver.ExtractZip(zipPath, saveDir, password)
	if extractErr != nil {
		logger.Warn("ZIP extraction failed, falling back to page-by-page download",
			"galleryId", galleryID, "error", extractErr.Error())
		database.Exec(ctx,
			`UPDATE gallery_download_infos SET status = 'failed', updated_at = CURRENT_TIMESTAMP
			 WHERE gallery_id = ?`, galleryID)
		return false
	}

	actualFiles := taskprogress.CountFilesOnDisk(saveDir)
	logger.Info("ZIP extraction completed",
		"galleryId", galleryID, "extractedFiles", actualFiles)

	_, _ = database.Exec(ctx,
		`UPDATE gallery_download_infos SET
			status = 'downloaded', local_path = ?, extracted_path = ?,
			actual_size = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE gallery_id = ?`,
		zipPath, saveDir, result.FileSize, galleryID)

	return true
}

// VerifyGallery reports whether every gallery image reached the downloaded
// state, returning (status, corrected, reason) using the same protocol as
// the filesystem verifier.
func VerifyGallery(ctx context.Context, database *db.Database, galleryID int, logger *infra.Logger) (string, int, string) {
	// Use COALESCE to handle NULL values from SUM when no rows exist
	var expectedImages, downloadedImages, failedImages int
	err := database.QueryRow(ctx,
		`SELECT
			COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END), 0) AS downloaded,
			COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
		FROM gallery_images WHERE gallery_id = ?`,
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
