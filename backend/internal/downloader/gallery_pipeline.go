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

// SanitizeFileName replaces characters that are invalid in file names
// and truncates over-long names for filesystem compatibility.
func SanitizeFileName(name string) string {
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

// ResolveOUOFn resolves an OUO short link to its direct download URL.
// It is injected by the orchestrator so the downloader package does not
// depend on orchestrator internals (avoids an import cycle).
type ResolveOUOFn func(ctx context.Context, ouoURL string) (string, error)

// TryDownloadGalleryZip attempts to download and extract a ZIP archive
// for a gallery when the gallery_download_infos table contains a valid
// download URL. Returns true if ZIP download + extraction succeeded,
// false if no ZIP is available or the download failed (caller falls back
// to page-by-page image download).
//
// The full flow mirrors the TS downloadAndExtractZip() implementation:
//  1. Query gallery_download_infos for the download URL
//  2. For OUO links: resolve the short link via resolveOUO (HTTP redirect chain)
//  3. Download the ZIP file using DownloadFileWithDomainFallback
//  4. Extract ZIP contents to the gallery save directory
//  5. Update gallery status with extracted file counts
func TryDownloadGalleryZip(ctx context.Context, database *db.Database, galleryID int, saveDir string, logger *infra.Logger, resolveOUO ResolveOUOFn, dlDefaults DownloadDefaults) bool {
	// Check if ZIP download info exists for this gallery.
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

	// Resolve OUO short links. The TS implementation used Playwright
	// (headless browser) to interact with OUO's "I'm a human" button.
	// The Go HTTP-only resolution via redirect chain may fail if OUO
	// requires JavaScript interaction. When it fails, we fall back to
	// page-by-page image download.
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
			// Mark as failed so we don't keep retrying the broken OUO link.
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

	// Download the ZIP file.
	zipFileName := fmt.Sprintf("gallery_%d.zip", galleryID)
	zipPath := filepath.Join(saveDir, zipFileName)
	opts := dlDefaults.ApplyTo(&DownloadOptions{
		Timeout: 3600_000_000_000, // 1 hour for large archives
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

	// Extract the ZIP archive. Password-protected archives use the
	// password stored in gallery_download_infos (extracted from the
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

	// Count extracted files for the gallery status.
	actualFiles := taskprogress.CountFilesOnDisk(saveDir)
	logger.Info("ZIP extraction completed",
		"galleryId", galleryID, "extractedFiles", actualFiles)

	// Update gallery_download_infos with success.
	_, _ = database.Exec(ctx,
		`UPDATE gallery_download_infos SET
			status = 'downloaded', local_path = ?, extracted_path = ?,
			actual_size = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE gallery_id = ?`,
		zipPath, saveDir, result.FileSize, galleryID)

	return true
}

// VerifyGallery queries the database to check whether all gallery
// images were successfully downloaded. It returns (status, corrected, reason)
// following the same protocol as the filesystem verifier.
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
