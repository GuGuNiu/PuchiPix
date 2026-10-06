package kanav

import (
	"context"
	"fmt"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/sites/universal"
)

var browserScraperLogger = infra.NewLogger("KanavBrowserScraper")

// ScrapeDetailBrowser scrapes a video detail page with the headless browser,
// retrying with a headful window when anti-bot protection blocks the attempt.
func ScrapeDetailBrowser(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	browserScraperLogger.Info("Scraping detail page with browser",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	result, err := universal.ScrapePage(ctx, pageURL)
	if err != nil {
		browserScraperLogger.Warn("Headless scrape failed, trying headful fallback",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})

		result, err = universal.ScrapePageHeadful(ctx, pageURL)
		if err != nil {
			return nil, fmt.Errorf("browser scrape failed: %w", err)
		}
	}

	browserScraperLogger.Info("Browser scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":        pageURL,
			"m3u8Found":  result.M3U8URL != "",
			"candidates": len(result.M3U8Candidates),
			"title":      result.Title,
		}})

	return result, nil
}

type ScrapeOptions struct {
	UseHeadful bool
	Timeout    int // Timeout in seconds
	AutoPlay   bool
}

func ScrapeDetailWithOptions(ctx context.Context, pageURL string, opts ScrapeOptions) (*sites.ScrapeResult, error) {
	if opts.UseHeadful {
		return universal.ScrapePageHeadful(ctx, pageURL)
	}
	return universal.ScrapePage(ctx, pageURL)
}

func ExtractM3U8FromPage(ctx context.Context, pageURL string) ([]string, error) {
	result, err := ScrapeDetailBrowser(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	var m3u8URLs []string
	if result.M3U8URL != "" {
		m3u8URLs = append(m3u8URLs, result.M3U8URL)
	}

	for _, cand := range result.M3U8Candidates {
		m3u8URLs = append(m3u8URLs, cand.URL)
	}

	return m3u8URLs, nil
}

type VideoDetailResult struct {
	sites.ScrapeResult
	VideoID      string `json:"videoId"`
	Views        int    `json:"views"`
	Duration     string `json:"duration"`
	PublishDate  string `json:"publishDate"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnailUrl"`
}

func ScrapeDetailEnhanced(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	baseResult, err := ScrapeDetailBrowser(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	videoID := ExtractVideoID(pageURL)

	enhanced := &VideoDetailResult{
		ScrapeResult: *baseResult,
		VideoID:      videoID,
	}

	// TODO: Re-fetch the page over HTTP for metadata the browser scraper
	// misses, such as views and duration

	return enhanced, nil
}
