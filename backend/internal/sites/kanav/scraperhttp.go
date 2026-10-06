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

func ScrapeListingHTTP(ctx context.Context, listingURL string) (*ListingPageResult, error) {
	httpScraperLogger.Info("Scraping listing page",
		infra.LogContext{Extra: map[string]any{
			"url": listingURL,
		}})

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", listingURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", stealth.RandomUA())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	// The site rejects requests that arrive without a same-site referer
	req.Header.Set("Referer", "https://v1.kanav.work/")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP error: %d", resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	videos := extractVideosFromDocument(doc)
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

func extractVideoFromElement(s *goquery.Selection) VideoMetadata {
	var video VideoMetadata

	videoItem := s.Find(".video-item")
	if videoItem.Length() == 0 {
		return video
	}

	linkElem := videoItem.Find(VideoLinkSelector)
	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.ID = ExtractVideoID(href)
	if video.ID == "" {
		return video
	}

	if strings.HasPrefix(href, "http") {
		video.PageURL = href
	} else {
		video.PageURL = "https://v1.kanav.work" + href
	}

	// data-original holds the real thumbnail; src is the lazy-load placeholder
	imgElem := videoItem.Find(VideoImageSelector)
	video.ThumbnailURL, _ = imgElem.Attr("data-original")
	if video.ThumbnailURL == "" {
		video.ThumbnailURL, _ = imgElem.Attr("src")
	}
	video.Title, _ = imgElem.Attr("alt")

	viewsElem := videoItem.Find(VideoViewsSelector)
	viewsText := strings.TrimSpace(viewsElem.Text())
	video.ViewsText = viewsText
	video.Views = ExtractViews(viewsText)

	durationElem := videoItem.Find(VideoDurationSelector)
	video.Duration = strings.TrimSpace(durationElem.Text())

	// The same overlay span carries the category label on the homepage and the
	// view count on listing pages, distinguished by the presence of "Views"
	if strings.Contains(viewsText, "Views") {
		video.Category = ""
	} else {
		video.Category = viewsText
	}

	entryTitle := s.Find(EntryTitleSelector)
	entryText := entryTitle.Text()
	video.PublishDate = ExtractDate(entryText)

	return video
}

type PaginationInfo struct {
	TotalPages  int
	CurrentPage int
	HasNextPage bool
	NextPageURL string
}

func extractPaginationFromDocument(doc *goquery.Document, currentURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	activePage := doc.Find(ActivePageSelector)
	if activePage.Length() > 0 {
		pageText := strings.TrimSpace(activePage.Text())
		if pageNum, err := strconv.Atoi(pageText); err == nil {
			info.CurrentPage = pageNum
		}
	} else {
		// Pages beyond the first carry the number in the URL instead of the pager
		info.CurrentPage = ExtractPageNumber(currentURL)
	}

	pagination := doc.Find(PaginationSelector)
	if pagination.Length() == 0 {
		return info
	}

	// Only a window of page links is rendered, so the total is the largest number
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

	// Themes drop the next arrow on the last page, so derive it from the page window
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		nextPageNum := info.CurrentPage + 1
		info.NextPageURL = buildNextPageURL(currentURL, nextPageNum)
	}

	return info
}

func buildNextPageURL(currentURL string, nextPage int) string {
	if strings.Contains(currentURL, "/page/") {
		return regexp.MustCompile(`/page/\d+\.html`).ReplaceAllString(
			currentURL,
			fmt.Sprintf("/page/%d.html", nextPage),
		)
	}

	if strings.HasSuffix(currentURL, ".html") {
		return strings.Replace(
			currentURL,
			".html",
			fmt.Sprintf("/page/%d.html", nextPage),
			1,
		)
	}

	return currentURL
}

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

			// A video can appear in several categories; keep the first occurrence
			for _, v := range result.Videos {
				if !seenIDs[v.ID] {
					seenIDs[v.ID] = true
					v.Category = cat.Name
					v.CategoryID = cat.ID
					allVideos = append(allVideos, v)
				}
			}

			if !result.HasNextPage {
				break
			}

			time.Sleep(500 * time.Millisecond)
		}
	}

	return allVideos, nil
}

func buildListingURL(baseURL string, categoryID int, sort SortType, page int) string {
	if page <= 1 {
		return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d.html", baseURL, sort, categoryID)
	}
	return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d/page/%d.html", baseURL, sort, categoryID, page)
}
