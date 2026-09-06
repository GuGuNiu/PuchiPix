package porn91

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var scraperLogger = infra.NewLogger("Porn91Scraper")

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in 91porn.plus video pages.
type jsonLDVideoObject struct {
	Type         string `json:"@type"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	ThumbnailURL []string `json:"thumbnailUrl"`
	UploadDate   string `json:"uploadDate"`
	Duration     string `json:"duration"`
	ContentURL   string `json:"contentUrl"`
	Author       string `json:"author"`
	InteractionStatistic struct {
		Type            string `json:"@type"`
		InteractionType struct {
			Type string `json:"@type"`
		} `json:"interactionType"`
		UserInteractionCount int `json:"userInteractionCount"`
	} `json:"interactionStatistic"`
}

// ScrapeDetailHTTP scrapes a video detail page via HTTP GET and extracts
// the M3U8 URL and metadata from the Schema.org JSON-LD structured data
// embedded in the HTML. This is the primary scraping method for 91porn.plus
// since the site embeds the video stream URL directly in JSON-LD without
// requiring JavaScript execution.
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	// Parse JSON-LD from the HTML.
	videoObj, err := extractJSONLDVideoObject(html)
	if err != nil {
		return nil, fmt.Errorf("JSON-LD extraction failed: %w", err)
	}

	videoID := ExtractVideoID(pageURL)

	thumbnailURL := ""
	if len(videoObj.ThumbnailURL) > 0 {
		thumbnailURL = videoObj.ThumbnailURL[0]
	}

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:           videoID,
			Title:        videoObj.Name,
			PageURL:      pageURL,
			ThumbnailURL: thumbnailURL,
			Views:        videoObj.InteractionStatistic.UserInteractionCount,
			ViewsText:    fmt.Sprintf("%d", videoObj.InteractionStatistic.UserInteractionCount),
			Duration:     parseISODuration(videoObj.Duration),
			PublishDate:  parseUploadDate(videoObj.UploadDate),
			Author:       videoObj.Author,
		},
		M3U8URL:     videoObj.ContentURL,
		Description: videoObj.Description,
	}

	scraperLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"videoId":   videoID,
			"m3u8Found": result.M3U8URL != "",
			"title":     result.Title,
			"views":     result.Views,
		}})

	return result, nil
}

// ScrapeDetailAsScrapeResult scrapes a video detail page and converts the
// result to a sites.ScrapeResult for compatibility with the universal
// pipeline used by the task creation flow.
func ScrapeDetailAsScrapeResult(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	detail, err := ScrapeDetailHTTP(ctx, pageURL)
	if err != nil {
		return nil, err
	}

	var tags []string
	var categories []string

	// Also parse the HTML with goquery for tag/category extraction.
	html, _ := fetchPageHTML(ctx, pageURL)
	if html != "" {
		if doc, err := goquery.NewDocumentFromReader(strings.NewReader(html)); err == nil {
			doc.Find(".tag a, .tags a, .category a").Each(func(_ int, s *goquery.Selection) {
				if text := strings.TrimSpace(s.Text()); text != "" && len(text) < 50 {
					tags = append(tags, text)
				}
			})
			if kw, ok := doc.Find(`meta[name="keywords"]`).Attr("content"); ok && kw != "" {
				for _, t := range strings.Split(kw, ",") {
					if t = strings.TrimSpace(t); t != "" {
						tags = append(tags, t)
					}
				}
			}
		}
	}

	return &sites.ScrapeResult{
		M3U8URL:    detail.M3U8URL,
		Title:      detail.Title,
		PageURL:    pageURL,
		Tags:       tags,
		Categories: categories,
		Actors:     []string{detail.Author},
	}, nil
}

// ScrapeListingHTTP scrapes a video listing page via HTTP request.
// This is suitable for category pages, search results, and the homepage.
func ScrapeListingHTTP(ctx context.Context, listingURL string) (*ListingPageResult, error) {
	scraperLogger.Info("Scraping listing page",
		infra.LogContext{Extra: map[string]any{
			"url": listingURL,
		}})

	html, err := fetchPageHTML(ctx, listingURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	videos := extractVideosFromDocument(doc, listingURL)

	// Determine the base URL for resolving relative links.
	baseURL := extractBaseURL(listingURL)

	pagination := extractPaginationFromDocument(doc, listingURL, baseURL)

	result := &ListingPageResult{
		Videos:      videos,
		TotalPages:  pagination.TotalPages,
		CurrentPage: pagination.CurrentPage,
		HasNextPage: pagination.HasNextPage,
		NextPageURL: pagination.NextPageURL,
	}

	scraperLogger.Info("Listing scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":          listingURL,
			"videosFound":  len(videos),
			"currentPage":  result.CurrentPage,
			"hasNextPage":  result.HasNextPage,
		}})

	return result, nil
}

// fetchPageHTML performs an HTTP GET request and returns the raw HTML body.
func fetchPageHTML(ctx context.Context, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", stealth.RandomUA())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP error: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read body: %w", err)
	}

	return string(bodyBytes), nil
}

// extractJSONLDVideoObject finds the first JSON-LD script block containing
// a VideoObject type and parses it into a jsonLDVideoObject struct.
func extractJSONLDVideoObject(html string) (*jsonLDVideoObject, error) {
	// Find all JSON-LD script blocks.
	blocks := JSONLDVideoObjectPattern.FindAllStringSubmatch(html, -1)
	if len(blocks) == 0 {
		// Fallback: try direct regex extraction of contentUrl from raw HTML.
		return extractVideoFromRawHTML(html)
	}

	for _, block := range blocks {
		if len(block) < 2 {
			continue
		}
		rawJSON := strings.TrimSpace(block[1])

		var obj jsonLDVideoObject
		if err := json.Unmarshal([]byte(rawJSON), &obj); err != nil {
			continue
		}

		if obj.Type == "VideoObject" {
			return &obj, nil
		}
	}

	// Fallback: try direct regex extraction.
	return extractVideoFromRawHTML(html)
}

// extractVideoFromRawHTML extracts the M3U8 URL and basic metadata using
// regex patterns as a fallback when JSON-LD parsing fails.
func extractVideoFromRawHTML(html string) (*jsonLDVideoObject, error) {
	contentMatch := ContentURLPattern.FindStringSubmatch(html)
	if len(contentMatch) < 2 || contentMatch[1] == "" {
		return nil, fmt.Errorf("no contentUrl found in page")
	}

	obj := &jsonLDVideoObject{
		Type:       "VideoObject",
		ContentURL: contentMatch[1],
	}

	if nameMatch := regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`).FindStringSubmatch(html); len(nameMatch) >= 2 {
		obj.Name = nameMatch[1]
	}
	if dateMatch := UploadDatePattern.FindStringSubmatch(html); len(dateMatch) >= 2 {
		obj.UploadDate = dateMatch[1]
	}
	if durMatch := regexp.MustCompile(`"duration"\s*:\s*"([^"]+)"`).FindStringSubmatch(html); len(durMatch) >= 2 {
		obj.Duration = durMatch[1]
	}
	if thumbMatch := ThumbnailPattern.FindStringSubmatch(html); len(thumbMatch) >= 2 {
		obj.ThumbnailURL = []string{thumbMatch[1]}
	}
	if countMatch := InteractionCountPattern.FindStringSubmatch(html); len(countMatch) >= 2 {
		obj.InteractionStatistic.UserInteractionCount = atoiSafe(countMatch[1])
	}

	return obj, nil
}

// extractVideosFromDocument extracts video metadata from a listing page document.
// 91porn.plus is an Angular SPA, so listing pages typically render video cards
// with predictable CSS classes. This function uses generic selectors that
// match common card patterns.
func extractVideosFromDocument(doc *goquery.Document, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

	// Try multiple card selectors for robustness.
	cardSelectors := []string{
		".video-item",
		".video-card",
		".video-list .item",
		".list-videos .item",
		".col .item",
		"[class*='video'] .item",
	}

	for _, selector := range cardSelectors {
		doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
			video := extractVideoFromElement(s, baseURL)
			if video.ID != "" && !seen[video.ID] {
				seen[video.ID] = true
				videos = append(videos, video)
			}
		})
		// If we found videos with this selector, no need to try others.
		if len(videos) > 0 {
			break
		}
	}

	// Fallback: try to find JSON-LD item lists on the page.
	if len(videos) == 0 {
		doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
			content := strings.TrimSpace(s.Text())
			if content == "" {
				return
			}
			// Try to parse as ItemList with VideoObject entries.
			var itemList struct {
				Type         string `json:"@type"`
				ItemListElement []struct {
					Type string `json:"@type"`
					Item jsonLDVideoObject `json:"item"`
				} `json:"itemListElement"`
			}
			if err := json.Unmarshal([]byte(content), &itemList); err == nil && itemList.Type == "ItemList" {
				for _, elem := range itemList.ItemListElement {
					v := elem.Item
					if v.Type != "VideoObject" || v.ContentURL == "" {
						continue
					}
					videoID := ExtractVideoID(v.ContentURL)
					if videoID == "" {
						// Try to extract from URL field or name
						videoID = v.Name
					}
					if videoID != "" && !seen[videoID] {
						seen[videoID] = true
						thumbURL := ""
						if len(v.ThumbnailURL) > 0 {
							thumbURL = v.ThumbnailURL[0]
						}
						videos = append(videos, VideoMetadata{
							ID:           videoID,
							Title:        v.Name,
							ThumbnailURL: thumbURL,
							Views:        v.InteractionStatistic.UserInteractionCount,
							Duration:     parseISODuration(v.Duration),
							PublishDate:  parseUploadDate(v.UploadDate),
						})
					}
				}
			}
		})
	}

	return videos
}

// extractVideoFromElement extracts a single video's metadata from a selection.
func extractVideoFromElement(s *goquery.Selection, baseURL string) VideoMetadata {
	var video VideoMetadata

	// Find the video link.
	linkElem := s.Find("a[href*='/video/']")
	if linkElem.Length() == 0 {
		// Try any link with href containing "video"
		linkElem = s.Find("a[href*='video']")
	}

	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.ID = ExtractVideoID(href)
	if video.ID == "" {
		return video
	}

	video.PageURL = resolveURL(href, baseURL)

	// Extract thumbnail.
	imgElem := s.Find("img")
	if imgElem.Length() > 0 {
		video.ThumbnailURL, _ = imgElem.Attr("data-src")
		if video.ThumbnailURL == "" {
			video.ThumbnailURL, _ = imgElem.Attr("data-original")
		}
		if video.ThumbnailURL == "" {
			video.ThumbnailURL, _ = imgElem.Attr("src")
		}
		video.Title, _ = imgElem.Attr("alt")
	}

	// If title not found from image alt, try from link text or title element.
	if video.Title == "" {
		titleElem := s.Find(".title, .video-title, h3, h4")
		if titleElem.Length() > 0 {
			video.Title = strings.TrimSpace(titleElem.Text())
		}
	}

	// Extract views.
	viewsElem := s.Find(".views, .view-count, [class*='view']")
	if viewsElem.Length() > 0 {
		viewsText := strings.TrimSpace(viewsElem.Text())
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

	// Extract duration.
	durationElem := s.Find(".duration, .time, [class*='duration']")
	if durationElem.Length() > 0 {
		video.Duration = strings.TrimSpace(durationElem.Text())
	}

	// Extract author.
	authorElem := s.Find(".author, .uploader, [class*='author']")
	if authorElem.Length() > 0 {
		video.Author = strings.TrimSpace(authorElem.Text())
	}

	return video
}

// PaginationInfo holds extracted pagination data.
type PaginationInfo struct {
	TotalPages  int
	CurrentPage int
	HasNextPage bool
	NextPageURL string
}

// extractPaginationFromDocument extracts pagination information from the document.
func extractPaginationFromDocument(doc *goquery.Document, currentURL string, baseURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	// Find pagination container.
	pagination := doc.Find(".pagination, .pager, [class*='pagination'], [class*='pager']")
	if pagination.Length() == 0 {
		return info
	}

	// Find active/current page.
	activePage := pagination.Find(".active, .current")
	if activePage.Length() > 0 {
		pageText := strings.TrimSpace(activePage.Text())
		info.CurrentPage = atoiSafe(pageText)
	}

	// Count total pages.
	maxPage := info.CurrentPage
	pagination.Find("a").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		// Look for "Next" or "›" or "»" indicators
		if strings.Contains(text, "Next") || strings.Contains(text, "下一页") ||
			strings.Contains(text, "›") || strings.Contains(text, "»") {
			if href, exists := s.Attr("href"); exists {
				info.HasNextPage = true
				info.NextPageURL = resolveURL(href, baseURL)
			}
		}
		// Try to extract page number
		if pageNum := atoiSafe(text); pageNum > maxPage {
			maxPage = pageNum
		}
	})

	info.TotalPages = maxPage

	// If no explicit next link but current page < max page.
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		info.NextPageURL = buildNextPageURL(currentURL, info.CurrentPage+1)
	}

	return info
}

// resolveURL resolves a relative URL to absolute using the base URL.
func resolveURL(href, baseURL string) string {
	if strings.HasPrefix(href, "http") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return "https:" + href
	}
	if strings.HasPrefix(href, "/") {
		return baseURL + href
	}
	return baseURL + "/" + href
}

// extractBaseURL extracts the scheme://host from a URL.
func extractBaseURL(rawURL string) string {
	idx := strings.Index(rawURL, "://")
	if idx < 0 {
		return rawURL
	}
	rest := rawURL[idx+3:]
	slashIdx := strings.Index(rest, "/")
	if slashIdx < 0 {
		return rawURL
	}
	return rawURL[:idx+3+slashIdx]
}

// buildNextPageURL constructs the next page URL based on the current URL pattern.
func buildNextPageURL(currentURL string, nextPage int) string {
	// 91porn.plus uses URL patterns like /category/1/latest/2
	// Replace the last numeric segment.
	re := regexp.MustCompile(`/(\d+)(?:/?)$`)
	if re.MatchString(currentURL) {
		return re.ReplaceAllString(currentURL, fmt.Sprintf("/%d", nextPage))
	}
	// If URL ends with /, append page number.
	if strings.HasSuffix(currentURL, "/") {
		return currentURL + fmt.Sprintf("%d", nextPage)
	}
	return currentURL + "/" + fmt.Sprintf("%d", nextPage)
}
