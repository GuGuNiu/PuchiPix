package kanav

import (
	"context"
	"fmt"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/sites/universal"
)

var browserScraperLogger = infra.NewLogger("KanavBrowserScraper")

// ScrapeDetailBrowser scrapes a video detail page using headless browser
// with M3U8 sniffing capabilities. This is the primary method for extracting
// video stream URLs from KanAV detail pages.
func ScrapeDetailBrowser(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	browserScraperLogger.Info("Scraping detail page with browser",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	// Use the universal scraper which has comprehensive M3U8 detection
	result, err := universal.ScrapePage(ctx, pageURL)
	if err != nil {
		browserScraperLogger.Warn("Headless scrape failed, trying headful fallback",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})

		// Fallback to headful browser for anti-bot protection
		result, err = universal.ScrapePageHeadful(ctx, pageURL)
		if err != nil {
			return nil, fmt.Errorf("browser scrape failed: %w", err)
		}
	}

	browserScraperLogger.Info("Browser scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":            pageURL,
			"m3u8Found":      result.M3U8URL != "",
			"candidates":     len(result.M3U8Candidates),
			"title":          result.Title,
		}})

	return result, nil
}

// ScrapeDetailWithOptions scrapes a detail page with customizable options.
type ScrapeOptions struct {
	UseHeadful bool          // Use visible browser window
	Timeout    int           // Timeout in seconds (default: 40)
	AutoPlay   bool          // Automatically click play buttons
}

// ScrapeDetailWithOptions scrapes with custom options.
func ScrapeDetailWithOptions(ctx context.Context, pageURL string, opts ScrapeOptions) (*sites.ScrapeResult, error) {
	if opts.UseHeadful {
		return universal.ScrapePageHeadful(ctx, pageURL)
	}
	return universal.ScrapePage(ctx, pageURL)
}

// ExtractM3U8FromPage extracts M3U8 URLs from a video page.
// This is a convenience wrapper around the universal scraper.
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

// VideoDetailResult extends the universal ScrapeResult with KanAV-specific metadata.
type VideoDetailResult struct {
	sites.ScrapeResult
	VideoID      string `json:"videoId"`
	Views        int    `json:"views"`
	Duration     string `json:"duration"`
	PublishDate  string `json:"publishDate"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnailUrl"`
}

// ScrapeDetailEnhanced scrapes a detail page and enriches with KanAV metadata.
func ScrapeDetailEnhanced(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	// First get the basic scrape result with M3U8
	baseResult, err := ScrapeDetailBrowser(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	// Extract video ID from URL
	videoID := ExtractVideoID(pageURL)

	// Create enhanced result
	enhanced := &VideoDetailResult{
		ScrapeResult: *baseResult,
		VideoID:      videoID,
	}

	// TODO: Optionally scrape the page again via HTTP to get metadata
	// that might not be captured by the universal scraper (views, duration, etc.)

	return enhanced, nil
}
