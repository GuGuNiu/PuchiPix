package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"backend/internal/db"
	"backend/internal/downloader/video"
	"backend/internal/infra"
	"backend/internal/orchestrator"
	"backend/internal/sites"
	"backend/internal/sites/universal"
)

// sniffVideoM3U8 identifies and persists the M3U8 URL for a video task.
// It is idempotent: when m3u8_url is already stored, it returns immediately.
func sniffVideoM3U8(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, taskID int) (pageURL, m3u8URL, storedTitle string, err error) {
	err = database.QueryRow(ctx,
		`SELECT dt.url, COALESCE(dt.m3u8_url, ''), COALESCE(vi.title, '') FROM download_tasks dt LEFT JOIN video_infos vi ON vi.task_id = dt.id WHERE dt.id = ?`,
		taskID).Scan(&pageURL, &m3u8URL, &storedTitle)
	if err != nil {
		return "", "", "", fmt.Errorf("query task %d: %w", taskID, err)
	}

	// Decode MacCMS-style encoded M3U8 URLs that may have been stored in
	// a previous run before the decode fix was added.
	m3u8URL = universal.DecodeMacCMSURL(m3u8URL)
	if m3u8URL != "" {
		return pageURL, m3u8URL, storedTitle, nil
	}

	var siteID string
	var mirrorDomains []string
	if siteReg != nil {
		if mod, ok := siteReg.GetModuleByUrl(pageURL); ok {
			siteID = mod.ID
			mirrorDomains = mod.Domains
		}
	}

	strategy := strategySelector.Select(orchestrator.SelectStrategyInput{
		SiteID:   siteID,
		TaskType: orchestrator.TaskTypeVideo,
	})

	var result *sites.ScrapeResult
	var scrapeErr error

	switch strategy {
	case orchestrator.StrategyHTTP:
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePageHTTP(ctx, url)
		}
		scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

	case orchestrator.StrategyChromedp:
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePage(ctx, url)
		}
		scrapeCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

	default: // StrategyAuto
		// Try HTTP first; escalate to chromedp if no valid M3U8 is found.
		logger.Info(fmt.Sprintf("M3U8 URL empty for task %d, trying HTTP scrape", taskID))
		scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePageHTTP(ctx, url)
		}
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

		// Quality gate: if HTTP didn't find a M3U8 or produced empty
		// results, escalate to chromedp.
		if scrapeErr != nil || (result != nil && result.M3U8URL == "" && result.Title == "") {
			logger.Info(fmt.Sprintf("HTTP scrape insufficient for task %d, escalating to chromedp", taskID))
			scrapeCtx2, cancel2 := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel2()
			scrapeFn2 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
				return universal.ScrapePage(ctx, url)
			}
			result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx2, pageURL, mirrorDomains, scrapeFn2)

			// Last resort: if headless chromedp also failed and the error
			// pattern suggests CloudFlare/WAF blocking, try a visible
			// (headful) browser.
			if scrapeErr != nil && isLikelyAntiBot(scrapeErr) {
				logger.Info(fmt.Sprintf("headless chromedp blocked for task %d, trying headful browser", taskID))
				scrapeCtx3, cancel3 := context.WithTimeout(ctx, 40*time.Second)
				defer cancel3()
				scrapeFn3 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
					return universal.ScrapePageHeadful(ctx, url)
				}
				result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx3, pageURL, mirrorDomains, scrapeFn3)
			}
		}
	}

	if scrapeErr != nil {
		return "", "", "", fmt.Errorf("scrape page for M3U8: %w", scrapeErr)
	}
	if result.M3U8URL == "" {
		return "", "", "", fmt.Errorf("no M3U8 URL found on page: %s", pageURL)
	}

	_, _ = database.Exec(ctx,
		`UPDATE download_tasks SET m3u8_url = ?, title = ? WHERE id = ?`,
		result.M3U8URL, result.Title, taskID)

	preWriteVideoInfo(ctx, database, taskID, result)

	// Emit task:metadata so SSE clients receive the scraped title
	// and actors in real-time without waiting for the polling fallback.
	if eventBus != nil {
		eventBus.Emit("task:metadata", map[string]any{
			"taskId":       taskID,
			"taskType":     "video",
			"GalleryTitle": result.Title,
			"Person":       strings.Join(result.Actors, ", "),
		})
	}

	return pageURL, result.M3U8URL, result.Title, nil
}

// loadVideoTaskInput loads the full DownloadTaskInput for the download
// executor, ensuring the M3U8 URL has been identified first (idempotent
// re-entry — a legacy single-node DAG may call this without a preceding
// video:scrape node). Best-effort metadata scrape fills title/tags/etc.
func loadVideoTaskInput(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, taskID int) (video.DownloadTaskInput, error) {
	pageURL, m3u8URL, storedTitle, err := sniffVideoM3U8(ctx, database, siteReg, strategySelector, eventBus, logger, taskID)
	if err != nil {
		return video.DownloadTaskInput{}, err
	}

	// Collect referer domains for CDN anti-hotlink bypass.
	var refererDomains []string
	if siteReg != nil {
		if mod, ok := siteReg.GetModuleByUrl(pageURL); ok {
			refererDomains = mod.Domains
		}
	}

	task := video.DownloadTaskInput{
		ID:             taskID,
		M3U8URL:        m3u8URL,
		PageURL:        pageURL,
		Title:          storedTitle,
		RefererDomains: refererDomains,
	}

	// Lightweight best-effort metadata scrape to enrich the input.
	metaCtx, metaCancel := context.WithTimeout(ctx, 30*time.Second)
	defer metaCancel()
	if meta, metaErr := universal.ScrapePage(metaCtx, pageURL); metaErr == nil {
		task.Title = meta.Title
		task.Tags = meta.Tags
		task.Actors = meta.Actors
		task.Categories = meta.Categories
		task.Director = meta.Director
	}
	return task, nil
}
