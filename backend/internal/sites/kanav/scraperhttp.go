package kanav

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/stealth"
)

var httpScraperLogger = infra.NewLogger("KanavHTTPScraper")

// ScrapeListingHTTP scrapes a video listing page via HTTP request.
// This is suitable for category pages, search results, and sorted listings.
func ScrapeListingHTTP(ctx context.Context, listingURL string) (*ListingPageResult, error) {
	httpScraperLogger.Info("Scraping listing page",
		infra.LogContext{Extra: map[string]any{
			"url": listingURL,
		}})

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", listingURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers to mimic browser
	req.Header.Set("User-Agent", stealth.RandomUA())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Referer", "https://v1.kanav.work/")

	// Execute request
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	// Check status
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP error: %d", resp.StatusCode)
	}

	// Parse HTML
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	// Extract videos
	videos := extractVideosFromDocument(doc)

	// Extract pagination info
	pagination := extractPaginationFromDocument(doc, listingURL)

	result := &ListingPageResult{
		Videos:      videos,
		TotalPages:  pagination.TotalPages,
		CurrentPage: pagination.CurrentPage,
		HasNextPage: pagination.HasNextPage,
		NextPageURL: pagination.NextPageURL,
	}

	httpScraperLogger.Info("Listing scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":         listingURL,
			"videosFound": len(videos),
			"currentPage": result.CurrentPage,
			"hasNextPage": result.HasNextPage,
		}})

	return result, nil
}

// extractVideosFromDocument extracts video metadata from the goquery document.
func extractVideosFromDocument(doc *goquery.Document) []VideoMetadata {
	var videos []VideoMetadata

	doc.Find(VideoItemSelector).Each(func(i int, s *goquery.Selection) {
		video := extractVideoFromElement(s)
		if video.ID != "" {
			videos = append(videos, video)
		}
	})

	return videos
}

// extractVideoFromElement extracts a single video's metadata from a selection.
func extractVideoFromElement(s *goquery.Selection) VideoMetadata {
	var video VideoMetadata

	// Find video item container
	videoItem := s.Find(".video-item")
	if videoItem.Length() == 0 {
		return video
	}

	// Extract link and ID
	linkElem := videoItem.Find(VideoLinkSelector)
	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.ID = ExtractVideoID(href)
	if video.ID == "" {
		return video
	}

	// Build full URL
	if strings.HasPrefix(href, "http") {
		video.PageURL = href
	} else {
		video.PageURL = "https://v1.kanav.work" + href
	}

	// Extract thumbnail and title
	imgElem := videoItem.Find(VideoImageSelector)
	video.ThumbnailURL, _ = imgElem.Attr("data-original")
	if video.ThumbnailURL == "" {
		video.ThumbnailURL, _ = imgElem.Attr("src")
	}
	video.Title, _ = imgElem.Attr("alt")

	// Extract views
	viewsElem := videoItem.Find(VideoViewsSelector)
	viewsText := strings.TrimSpace(viewsElem.Text())
	video.ViewsText = viewsText
	video.Views = ExtractViews(viewsText)

	// Extract duration
	durationElem := videoItem.Find(VideoDurationSelector)
	video.Duration = strings.TrimSpace(durationElem.Text())

	// Extract category from views element (it's used as category label on homepage)
	// On listing pages, this shows views; on homepage, it shows category
	if strings.Contains(viewsText, "Views") {
		video.Category = ""
	} else {
		video.Category = viewsText
	}

	// Extract date from entry-title
	entryTitle := s.Find(EntryTitleSelector)
	entryText := entryTitle.Text()
	video.PublishDate = ExtractDate(entryText)

	return video
}

// PaginationInfo holds extracted pagination data.
type PaginationInfo struct {
	TotalPages  int
	CurrentPage int
	HasNextPage bool
	NextPageURL string
}

// extractPaginationFromDocument extracts pagination information.
func extractPaginationFromDocument(doc *goquery.Document, currentURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	// Find active page number
	activePage := doc.Find(ActivePageSelector)
	if activePage.Length() > 0 {
		pageText := strings.TrimSpace(activePage.Text())
		if pageNum, err := strconv.Atoi(pageText); err == nil {
			info.CurrentPage = pageNum
		}
	} else {
		// Try to extract from URL
		info.CurrentPage = ExtractPageNumber(currentURL)
	}

	// Find pagination container
	pagination := doc.Find(PaginationSelector)
	if pagination.Length() == 0 {
		return info
	}

	// Count total pages (find the highest page number)
	maxPage := 1
	pagination.Find("a").Each(func(i int, s *goquery.Selection) {
		href, exists := s.Attr("href")
		if !exists {
			return
		}

		pageNum := ExtractPageNumber(href)
		if pageNum > maxPage {
			maxPage = pageNum
		}
	})

	info.TotalPages = maxPage

	// Check for next page
	nextLink := pagination.Find("a[aria-label='Next'], a:contains('下一页'), a:contains('»')")
	if nextLink.Length() > 0 {
		href, exists := nextLink.Attr("href")
		if exists && !nextLink.HasClass("disabled") {
			info.HasNextPage = true
			if strings.HasPrefix(href, "http") {
				info.NextPageURL = href
			} else {
				info.NextPageURL = "https://v1.kanav.work" + href
			}
		}
	}

	// If no explicit next link, check if current page < max page
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		// Construct next page URL
		nextPageNum := info.CurrentPage + 1
		info.NextPageURL = buildNextPageURL(currentURL, nextPageNum)
	}

	return info
}

// buildNextPageURL constructs the next page URL based on current URL pattern.
func buildNextPageURL(currentURL string, nextPage int) string {
	// Check if URL already has /page/N pattern
	if strings.Contains(currentURL, "/page/") {
		// Replace page number
		return regexp.MustCompile(`/page/\d+\.html`).ReplaceAllString(
			currentURL,
			fmt.Sprintf("/page/%d.html", nextPage),
		)
	}

	// Check if URL ends with .html
	if strings.HasSuffix(currentURL, ".html") {
		// Insert /page/N before .html
		return strings.Replace(
			currentURL,
			".html",
			fmt.Sprintf("/page/%d.html", nextPage),
			1,
		)
	}

	return currentURL
}

// ScrapeAllCategories scrapes the latest videos from all categories.
func ScrapeAllCategories(ctx context.Context, sort SortType, maxPagesPerCategory int) ([]VideoMetadata, error) {
	var allVideos []VideoMetadata
	seenIDs := make(map[string]bool)

	for _, cat := range CategoryConfigs {
		httpScraperLogger.Info("Scraping category",
			infra.LogContext{Extra: map[string]any{
				"category": cat.Name,
				"id":       cat.ID,
			}})

		for page := 1; page <= maxPagesPerCategory; page++ {
			listingURL := buildListingURL("https://v1.kanav.work", cat.ID, sort, page)

			result, err := ScrapeListingHTTP(ctx, listingURL)
			if err != nil {
				httpScraperLogger.Warn("Failed to scrape category page",
					infra.LogContext{Extra: map[string]any{
						"category": cat.Name,
						"page":     page,
						"error":    err.Error(),
					}})
				continue
			}

			// Add videos, avoiding duplicates
			for _, v := range result.Videos {
				if !seenIDs[v.ID] {
					seenIDs[v.ID] = true
					v.Category = cat.Name
					v.CategoryID = cat.ID
					allVideos = append(allVideos, v)
				}
			}

			// Stop if no next page
			if !result.HasNextPage {
				break
			}

			// Small delay to be polite
			time.Sleep(500 * time.Millisecond)
		}
	}

	return allVideos, nil
}

// buildListingURL constructs a listing URL for the given parameters.
func buildListingURL(baseURL string, categoryID int, sort SortType, page int) string {
	if page <= 1 {
		return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d.html", baseURL, sort, categoryID)
	}
	return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d/page/%d.html", baseURL, sort, categoryID, page)
}
