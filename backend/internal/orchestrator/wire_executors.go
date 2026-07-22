package orchestrator

import (
	"context"
	"fmt"
	"path/filepath"

	"backend/internal/archiver"
	"backend/internal/downloader"
	"backend/internal/infra"
	"backend/internal/orchestrator/executors"
	"backend/internal/sites"
)

// WireExecutors registers the four gallery executors (scrape, download,
// verify, extract) with actual production implementations, replacing
// the nil-callback "simulating success" behavior with real work via
// the SiteRegistry, DownloadManager, ContentVerifier, and Archiver.
func WireExecutors(reg *executors.Registry, siteReg *sites.SiteRegistry) {
	reg.Register(newScrapeExecutor(siteReg))
	reg.Register(newDownloadExecutor())
	reg.Register(newVerifyExecutor())
	reg.Register(newExtractExecutor())
	infra.NewLogger("WireExecutors").Info("Executors wired to production implementations")
}

// newScrapeExecutor builds a ScrapeExecutor whose providerFn routes the
// URL through the SiteRegistry to the correct GallerySiteProvider.
func newScrapeExecutor(siteReg *sites.SiteRegistry) *executors.ScrapeExecutor {
	fn := func(ctx context.Context, url string) (map[string]any, error) {
		provider, ok := siteReg.GetProviderByUrl(url)
		if !ok {
			return nil, fmt.Errorf("no provider registered for URL: %s", url)
		}
		galleryProvider, ok := provider.(sites.GallerySiteProvider)
		if !ok {
			return nil, fmt.Errorf("provider %s does not implement GallerySiteProvider", provider.SiteID())
		}
		result, err := galleryProvider.ScrapeGallery(ctx, url)
		if err != nil {
			return nil, fmt.Errorf("scrape gallery: %w", err)
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
// atomic write semantics.
func newDownloadExecutor() *executors.DownloadExecutor {
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
	return executors.NewDownloadExecutor(fn)
}

// newVerifyExecutor builds a VerifyExecutor whose verifyFn checks
// extracted content against the expected file counts and returns the
// (status, corrected, reason) triple that the orchestrator expects.
func newVerifyExecutor() *executors.VerifyExecutor {
	fn := func(ctx context.Context, node executors.ExecutorNode) (string, int, string) {
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
