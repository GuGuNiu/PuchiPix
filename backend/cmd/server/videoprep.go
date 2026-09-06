package main

import (
	"context"
	"encoding/json"
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
//
// taskSeq is the canonical uppercase-alphanumeric task identifier
// (download_tasks.seq). All lookups use the seq column for uniform
// letter+number ID format across the whole site.
func sniffVideoM3U8(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, taskSeq string) (pageURL, m3u8URL, storedTitle string, err error) {
	var taskID int
	err = database.QueryRow(ctx,
		`SELECT dt.id, dt.url, COALESCE(dt.m3u8_url, ''), COALESCE(vi.title, '')
		   FROM download_tasks dt
		   LEFT JOIN video_infos vi ON vi.task_id = dt.id
		   WHERE dt.seq = ?`,
		taskSeq).Scan(&taskID, &pageURL, &m3u8URL, &storedTitle)
	if err != nil {
		return "", "", "", fmt.Errorf("query task seq %s: %w", taskSeq, err)
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
		logger.Info(fmt.Sprintf("M3U8 URL empty for task %s, trying HTTP scrape", taskSeq))
		scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePageHTTP(ctx, url)
		}
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn)

		// Quality gate: if HTTP didn't find a M3U8 or produced empty
		// results, escalate to chromedp.
		if scrapeErr != nil || (result != nil && result.M3U8URL == "" && result.Title == "") {
			logger.Info(fmt.Sprintf("HTTP scrape insufficient for task %s, escalating to chromedp", taskSeq))
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
				logger.Info(fmt.Sprintf("headless chromedp blocked for task %s, trying headful browser", taskSeq))
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

	// Persist m3u8_url — title is stored via preWriteVideoInfo into
	// video_infos, not download_tasks. Previously the UPDATE referenced
	// a non-existent "title" column and the error was silently discarded
	// ( _, _ = ), causing scrape node to report success while the
	// download node later read an empty m3u8_url and failed with 0
	// segments.
	if _, err := database.Exec(ctx,
		`UPDATE download_tasks SET m3u8_url = ? WHERE seq = ?`,
		result.M3U8URL, taskSeq); err != nil {
		return "", "", "", fmt.Errorf("persist m3u8_url for seq %s: %w", taskSeq, err)
	}

	preWriteVideoInfo(ctx, database, taskID, result)

	// Emit task:metadata so SSE clients receive the scraped title,
	// actors AND tags in real-time without waiting for the polling
	// fallback. Tags/Actors are emitted as plain string arrays — the
	// store normalizes defensively on the client side.
	// Use the NUMERIC task ID: the frontend store keys tasks as
	// "${taskType}-${numericID}", and a string taskSeq here would never
	// match (metadata silently dropped → title only visible after F5).
	if eventBus != nil {
		eventBus.Emit("task:metadata", map[string]any{
			"taskId":       taskID,
			"taskType":     "video",
			"GalleryTitle": result.Title,
			"Person":       strings.Join(result.Actors, ", "),
			"Tags":         result.Tags,
			"Actors":       result.Actors,
		})
	}

	return pageURL, result.M3U8URL, result.Title, nil
}

// loadVideoTaskInput loads the full DownloadTaskInput for the download
// executor, ensuring the M3U8 URL has been identified first (idempotent
// re-entry — a legacy single-node DAG may call this without a preceding
// video:scrape node). Best-effort metadata scrape fills title/tags/etc.
//
// taskSeq is the canonical uppercase-alphanumeric task identifier.
// The returned DownloadTaskInput uses the numeric ID internally (for DB
// lookups by the DownloadManager) while all external references use seq.
func loadVideoTaskInput(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, taskSeq string) (video.DownloadTaskInput, error) {
	pageURL, m3u8URL, storedTitle, err := sniffVideoM3U8(ctx, database, siteReg, strategySelector, eventBus, logger, taskSeq)
	if err != nil {
		return video.DownloadTaskInput{}, err
	}

	var taskID int
	if err := database.QueryRow(ctx, "SELECT id FROM download_tasks WHERE seq = ?", taskSeq).Scan(&taskID); err != nil {
		return video.DownloadTaskInput{}, fmt.Errorf("resolve numeric id for seq %s: %w", taskSeq, err)
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

	// Seed tags/actors/etc. from the already-persisted video_infos row.
	// The best-effort scrape below frequently fails (anti-bot, timeout);
	// without this seed the empty result was later upserted over good
	// metadata, wiping tags/actors on every retry (2026-09-05 defect).
	var dbTags, dbActors, dbCategories, dbDirector string
	_ = database.QueryRow(ctx,
		`SELECT COALESCE(tags, ''), COALESCE(actors, ''), COALESCE(categories, ''), COALESCE(director, '')
		 FROM video_infos WHERE task_id = ?`, taskID).
		Scan(&dbTags, &dbActors, &dbCategories, &dbDirector)
	task.Tags = decodeJSONStringArray(dbTags)
	task.Actors = decodeJSONStringArray(dbActors)
	task.Categories = decodeJSONStringArray(dbCategories)
	task.Director = dbDirector

	// Lightweight best-effort metadata scrape to enrich the input.
	metaCtx, metaCancel := context.WithTimeout(ctx, 30*time.Second)
	defer metaCancel()
	if meta, metaErr := universal.ScrapePage(metaCtx, pageURL); metaErr == nil {
		if len(meta.Title) > 0 {
			task.Title = meta.Title
		}
		if len(meta.Tags) > 0 {
			task.Tags = meta.Tags
		}
		if len(meta.Actors) > 0 {
			task.Actors = meta.Actors
		}
		if len(meta.Categories) > 0 {
			task.Categories = meta.Categories
		}
		if meta.Director != "" {
			task.Director = meta.Director
		}
	}
	return task, nil
}

// decodeJSONStringArray parses the JSON array format used by the
// video_infos tags/actors/categories columns. Returns nil for empty or
// malformed values.
func decodeJSONStringArray(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" || trimmed == "[]" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(trimmed), &arr); err != nil {
		return nil
	}
	return arr
}
