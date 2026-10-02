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
	"backend/internal/stealth"
	"backend/internal/titleparser"
	"backend/internal/xutil"
)

func normalizeVideoMetadata(result *sites.ScrapeResult, parser *titleparser.Parser) {
	if result == nil {
		return
	}
	result.Title = xutil.CleanText(universal.CleanTitle(result.Title))
	result.Tags = xutil.CleanTagList(result.Tags)
	result.Actors = xutil.CleanActorList(result.Actors)
	if parser != nil {
		result.Actors = parser.NormalizeActors(result.Actors, result.Title)
	}
	excluded := append(append([]string(nil), result.Actors...), result.Title)
	if parser != nil {
		result.Tags = parser.RemoveActorsFromTags(result.Tags, excluded)
	} else {
		result.Tags = xutil.RemoveMetadataValues(result.Tags, excluded)
	}
	result.Categories = xutil.CleanTagList(result.Categories)
	result.Director = xutil.CleanText(result.Director)
}

func mergeVideoMetadata(task *video.DownloadTaskInput, scraped *sites.ScrapeResult, parser *titleparser.Parser) {
	if task == nil || scraped == nil {
		return
	}
	normalizeVideoMetadata(scraped, parser)
	if scraped.Title != "" {
		task.Title = scraped.Title
	}
	actors := append(append([]string(nil), task.Actors...), scraped.Actors...)
	if parser != nil {
		actors = parser.NormalizeActors(actors, task.Title)
	} else {
		actors = xutil.CleanActorList(actors)
	}
	task.Actors = actors
	mergedTags := xutil.MergeMetadata(task.Tags, scraped.Tags)
	excluded := append(append([]string(nil), actors...), task.Title)
	if parser != nil {
		task.Tags = parser.RemoveActorsFromTags(mergedTags, excluded)
	} else {
		task.Tags = xutil.RemoveMetadataValues(mergedTags, excluded)
	}
	task.Categories = xutil.MergeMetadata(task.Categories, scraped.Categories)
	if scraped.Director != "" {
		task.Director = scraped.Director
	}
}

// sniffVideoM3U8 identifies and persists the M3U8 URL for a video task.
// It is idempotent for as long as the stored stream URL's signature remains
// valid; once the signature expires the page is scraped again to obtain a
// fresh one.
//
// taskSeq is the canonical uppercase-alphanumeric task identifier
// (download_tasks.seq). All lookups use the seq column for uniform
// letter+number ID format across the whole site.
func sniffVideoM3U8(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, parser *titleparser.Parser, taskSeq string) (pageURL, m3u8URL, storedTitle string, err error) {
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

	// Rows written before M3U8 decoding was added may hold an encoded URL.
	m3u8URL = universal.DecodeMacCMSURL(m3u8URL)
	// A stored stream URL is reusable only while its signature is valid.
	// The media CDNs embed a short expiry, so a task identified long before
	// it gets scheduled must be re-identified rather than trusted; the
	// re-identification below overwrites the stale value.
	if m3u8URL != "" && !stealth.StreamURLExpired(m3u8URL, time.Now()) {
		return pageURL, m3u8URL, universal.CleanTitle(storedTitle), nil
	}
	if m3u8URL != "" {
		logger.Info(fmt.Sprintf("Stored stream URL for task %s has expired, re-identifying", taskSeq))
	}

	var siteID string
	var mirrorDomains []string
	if siteReg != nil {
		if mod, ok := siteReg.GetModuleByUrl(pageURL); ok {
			siteID = mod.ID
			// The domain pool is used rather than the static configured
			// list so mirror discovery and health scoring apply.
			mirrorDomains = stealth.DomainsForSite(mod.ID)
			if len(mirrorDomains) == 0 {
				mirrorDomains = mod.Domains
			}
		}
	}

	// A mirror that answers HTTP 200 with a page holding no stream must not
	// end the loop: the remaining mirrors are exactly the ones that can serve
	// this task. Without this predicate the first responding domain wins and
	// the rest are never tried.
	hasStream := func(r *sites.ScrapeResult) bool { return r != nil && r.M3U8URL != "" }

	// A site that server-renders its player configuration identifies the
	// stream and its full metadata over plain HTTP, so its own provider is
	// asked first. Only when that fails does the generic path run, which
	// needs a browser and can only recover MacCMS-style metadata.
	if providerResult, providerErr := scrapeVideoViaProvider(ctx, siteReg, pageURL); providerErr == nil && hasStream(providerResult) {
		normalizeVideoMetadata(providerResult, parser)
		if err := persistVideoScrape(ctx, database, eventBus, taskID, taskSeq, pageURL, providerResult); err != nil {
			return "", "", "", err
		}
		return pageURL, providerResult.M3U8URL, providerResult.Title, nil
	} else if providerErr != nil {
		logger.Info(fmt.Sprintf("site provider scrape did not yield a stream for task %s, falling back to generic scrape", taskSeq))
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
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn, hasStream)

	case orchestrator.StrategyChromedp:
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePage(ctx, url)
		}
		scrapeCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn, hasStream)

	default: // StrategyAuto
		// Escalate to chromedp when HTTP found no usable M3U8.
		logger.Info(fmt.Sprintf("M3U8 URL empty for task %s, trying HTTP scrape", taskSeq))
		scrapeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		scrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
			return universal.ScrapePageHTTP(ctx, url)
		}
		result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx, pageURL, mirrorDomains, scrapeFn, hasStream)

		// Quality gate: if HTTP didn't find a M3U8 or produced empty
		// results, escalate to chromedp.
		if scrapeErr != nil || result == nil || result.M3U8URL == "" {
			logger.Info(fmt.Sprintf("HTTP scrape insufficient for task %s, escalating to chromedp", taskSeq))
			scrapeCtx2, cancel2 := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel2()
			scrapeFn2 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
				return universal.ScrapePage(ctx, url)
			}
			result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx2, pageURL, mirrorDomains, scrapeFn2, hasStream)

			// A headful browser is the only remaining option when
			// headless chromedp is blocked by a CloudFlare/WAF challenge.
			if scrapeErr != nil && isLikelyAntiBot(scrapeErr) {
				logger.Info(fmt.Sprintf("headless chromedp blocked for task %s, trying headful browser", taskSeq))
				scrapeCtx3, cancel3 := context.WithTimeout(ctx, 40*time.Second)
				defer cancel3()
				scrapeFn3 := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
					return universal.ScrapePageHeadful(ctx, url)
				}
				result, scrapeErr = universal.ScrapePageWithFallback(scrapeCtx3, pageURL, mirrorDomains, scrapeFn3, hasStream)
			}
		}
	}

	if scrapeErr != nil {
		return "", "", "", fmt.Errorf("scrape page for M3U8: %w", scrapeErr)
	}
	if result.M3U8URL == "" {
		return "", "", "", fmt.Errorf("no M3U8 URL found on page: %s", pageURL)
	}
	normalizeVideoMetadata(result, parser)

	if err := persistVideoScrape(ctx, database, eventBus, taskID, taskSeq, pageURL, result); err != nil {
		return "", "", "", err
	}

	return pageURL, result.M3U8URL, result.Title, nil
}

// scrapeVideoViaProvider asks the site's own provider to identify the stream
// and metadata. It reports ok=false when no provider claims the URL or the
// provider declines to implement VideoDetailProvider, which is the normal
// case for gallery sites.
func scrapeVideoViaProvider(ctx context.Context, siteReg *sites.SiteRegistry, pageURL string) (result *sites.ScrapeResult, err error) {
	if siteReg == nil {
		return nil, nil
	}
	provider, ok := siteReg.GetProviderByUrl(pageURL)
	if !ok || provider == nil {
		return nil, nil
	}
	videoProvider, ok := provider.(sites.VideoDetailProvider)
	if !ok {
		return nil, nil
	}
	return videoProvider.ScrapeVideoDetail(ctx, pageURL)
}

// persistVideoScrape stores the identified stream and its metadata. Only
// m3u8_url is written to download_tasks; the title and the rest live in
// video_infos via preWriteVideoInfo.
func persistVideoScrape(ctx context.Context, database *db.Database, eventBus *infra.EventBus, taskID int, taskSeq, pageURL string, result *sites.ScrapeResult) error {
	if _, err := database.Exec(ctx,
		`UPDATE download_tasks SET m3u8_url = ? WHERE seq = ?`,
		result.M3U8URL, taskSeq); err != nil {
		return fmt.Errorf("persist m3u8_url for seq %s: %w", taskSeq, err)
	}

	preWriteVideoInfo(ctx, database, taskID, result)

	// Emitting task:metadata lets SSE clients see the scraped title, actors
	// and tags without waiting for the polling fallback. The numeric task ID
	// is required because the frontend store keys tasks as
	// "${taskType}-${numericID}", so a string seq would never match and the
	// metadata would be dropped. Tags/Actors go out as plain string arrays.
	if eventBus != nil {
		eventBus.Emit("task:metadata", map[string]any{
			"taskId":       taskID,
			"taskType":     "video",
			"GalleryTitle": result.Title,
			"Person":       strings.Join(result.Actors, ", "),
			"Tags":         result.Tags,
			"Actors":       result.Actors,
			"Categories":   result.Categories,
		})
	}

	return nil
}

// loadVideoTaskInput loads the full DownloadTaskInput for the download
// executor, ensuring the M3U8 URL has been identified first. The call is
// idempotent, so a single-node DAG can reach it with no preceding
// video:scrape node. A best-effort metadata scrape fills title/tags/etc.
//
// taskSeq is the canonical uppercase-alphanumeric task identifier.
// The returned DownloadTaskInput uses the numeric ID internally (for DB
// lookups by the DownloadManager) while all external references use seq.
func loadVideoTaskInput(ctx context.Context, database *db.Database, siteReg *sites.SiteRegistry, strategySelector *orchestrator.StrategySelector, eventBus *infra.EventBus, logger *infra.Logger, parser *titleparser.Parser, taskSeq string) (video.DownloadTaskInput, error) {
	pageURL, m3u8URL, storedTitle, err := sniffVideoM3U8(ctx, database, siteReg, strategySelector, eventBus, logger, parser, taskSeq)
	if err != nil {
		return video.DownloadTaskInput{}, err
	}

	var taskID int
	if err := database.QueryRow(ctx, "SELECT id FROM download_tasks WHERE seq = ?", taskSeq).Scan(&taskID); err != nil {
		return video.DownloadTaskInput{}, fmt.Errorf("resolve numeric id for seq %s: %w", taskSeq, err)
	}

	// Collect referer domains for CDN anti-hotlink bypass. The pool is used
	// rather than the raw configured list so the candidates arrive in health
	// order and include any dynamically discovered mirror.
	var refererDomains []string
	if siteReg != nil {
		if mod, ok := siteReg.GetModuleByUrl(pageURL); ok {
			refererDomains = stealth.DomainsForSite(mod.ID)
			if len(refererDomains) == 0 {
				refererDomains = mod.Domains
			}
		}
	}

	task := video.DownloadTaskInput{
		ID:             taskID,
		M3U8URL:        m3u8URL,
		PageURL:        pageURL,
		Title:          storedTitle,
		RefererDomains: refererDomains,
	}

	// Seed tags/actors/etc. from the already-persisted video_infos row: the
	// best-effort scrape below frequently fails (anti-bot, timeout), and an
	// empty result upserted over that row would wipe tags/actors.
	var dbTags, dbActors, dbCategories, dbDirector string
	_ = database.QueryRow(ctx,
		`SELECT COALESCE(tags, ''), COALESCE(actors, ''), COALESCE(categories, ''), COALESCE(director, '')
		 FROM video_infos WHERE task_id = ?`, taskID).
		Scan(&dbTags, &dbActors, &dbCategories, &dbDirector)
	task.Tags = xutil.CleanTagList(decodeJSONStringArray(dbTags))
	task.Actors = xutil.CleanActorList(decodeJSONStringArray(dbActors))
	task.Categories = xutil.CleanTagList(decodeJSONStringArray(dbCategories))
	task.Director = xutil.CleanText(dbDirector)
	if parser != nil {
		task.Actors = parser.NormalizeActors(task.Actors, task.Title)
	}
	excluded := append(append([]string(nil), task.Actors...), task.Title)
	if parser != nil {
		task.Tags = parser.RemoveActorsFromTags(task.Tags, excluded)
	} else {
		task.Tags = xutil.RemoveMetadataValues(task.Tags, excluded)
	}

	// Lightweight best-effort metadata scrape to enrich the input. The site
	// provider is preferred because it costs one plain HTTP request, while
	// the generic path drives a browser. It goes through the mirror loop so a
	// dead or throttled domain is reported to the health tracker instead of
	// silently costing 30s on every task.
	metaCtx, metaCancel := context.WithTimeout(ctx, 30*time.Second)
	defer metaCancel()

	if meta, metaErr := scrapeVideoViaProvider(metaCtx, siteReg, pageURL); metaErr == nil && meta != nil {
		mergeVideoMetadata(&task, meta, parser)
		return task, nil
	}

	metaScrapeFn := func(ctx context.Context, url string) (*sites.ScrapeResult, error) {
		return universal.ScrapePage(ctx, url)
	}
	if meta, metaErr := universal.ScrapePageWithFallback(metaCtx, pageURL, refererDomains, metaScrapeFn); metaErr == nil {
		mergeVideoMetadata(&task, meta, parser)
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
