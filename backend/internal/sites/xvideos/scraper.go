package xvideos

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

var scraperLogger = infra.NewLogger("XvideosScraper")

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in XVIDEOS video pages.
type jsonLDVideoObject struct {
	Type         string   `json:"@type"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	ThumbnailURL []string `json:"thumbnailUrl"`
	UploadDate   string   `json:"uploadDate"`
	Duration     string   `json:"duration"`
	ContentURL   string   `json:"contentUrl"`
	Author       string   `json:"author"`
	InteractionStatistic struct {
		Type            string `json:"@type"`
		InteractionType struct {
			Type string `json:"@type"`
		} `json:"interactionType"`
		UserInteractionCount int `json:"userInteractionCount"`
	} `json:"interactionStatistic"`
}

// ScrapeDetailHTTP scrapes a video detail page via HTTP GET and extracts
// the HLS M3U8 URL and MP4 direct link from inline <script> tags containing
// html5player API calls. This is the primary scraping method for XVIDEOS
// since the site embeds the video stream URLs directly in server-rendered
// HTML without requiring JavaScript execution.
//
// Extraction strategy:
//  1. Fetch page HTML via HTTP GET
//  2. Regex match setVideoHLS('...') for M3U8 URL
//  3. Regex match setVideoUrlLow/High('...') for MP4 URL
//  4. Parse JSON-LD for structured metadata (title, views, date, etc.)
//  5. Fall back to html5player API calls and OG meta tags
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	encodedID := ExtractEncodedID(pageURL)

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:        encodedID,
			EncodedID: encodedID,
			PageURL:   pageURL,
		},
	}

	// Extract HLS M3U8 URL from setVideoHLS('...').
	if m := HLSURLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.M3U8URL = m[1]
		// Also extract video UUID from the HLS URL.
		if uuidMatch := VideoUUIDPattern.FindStringSubmatch(result.M3U8URL); len(uuidMatch) >= 2 {
			result.VideoUUID = uuidMatch[1]
		}
	}

	// Extract MP4 URL from setVideoUrlLow/High('...').
	if m := MP4URLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.MP4URL = m[1]
	}

	// Extract CDN ID from setIdCDN('...').
	if m := CDNIDPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.CDNID = m[1]
	}

	// Extract uploader name from setUploaderName('...').
	if m := UploaderPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.Uploader = m[1]
	}

	// Try to extract title from JSON-LD first, then fall back to html5player.
	result.Title = extractTitle(html, pageURL)

	// Extract thumbnail from OG image or html5player.
	result.ThumbnailURL = extractThumbnail(html)

	// Extract views, duration, and publish date from JSON-LD.
	extractMetadataFromJSONLD(html, result)

	// Extract tags from the page.
	result.Tags = extractTagsFromHTML(html)

	scraperLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":         pageURL,
			"videoId":     encodedID,
			"m3u8Found":   result.M3U8URL != "",
			"mp4Found":    result.MP4URL != "",
			"title":       result.Title,
			"uploader":    result.Uploader,
			"views":       result.Views,
			"tagsCount":   len(result.Tags),
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

	return &sites.ScrapeResult{
		M3U8URL: detail.M3U8URL,
		Title:   detail.Title,
		PageURL: pageURL,
		Tags:    detail.Tags,
		Actors:  []string{detail.Uploader},
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
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

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

// extractTitle extracts the video title from JSON-LD, OG meta, or html5player.
func extractTitle(html, pageURL string) string {
	// Try JSON-LD first.
	if blocks := JSONLDVideoObjectPattern.FindAllStringSubmatch(html, -1); len(blocks) > 0 {
		for _, block := range blocks {
			if len(block) < 2 {
				continue
			}
			rawJSON := strings.TrimSpace(block[1])
			var obj jsonLDVideoObject
			if err := json.Unmarshal([]byte(rawJSON), &obj); err == nil && obj.Type == "VideoObject" && obj.Name != "" {
				return obj.Name
			}
		}
	}

	// Try OG title meta tag.
	if m := OGTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	// Try html5player.setVideoTitle('...').
	if m := VideoTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	// Try JSON-LD name field via regex.
	if m := JSONLDNamePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	return ""
}

// extractThumbnail extracts the thumbnail/poster URL from OG image or html5player.
func extractThumbnail(html string) string {
	// Try OG image meta tag.
	if m := OGImagePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	// Try JSON-LD thumbnailUrl.
	if m := JSONLDThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	// Try html5player.setVideoThumbUrl('...') or setThumbUrl('...').
	if m := ThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	return ""
}

// extractMetadataFromJSONLD extracts views, duration, and publish date from
// JSON-LD structured data using regex patterns.
func extractMetadataFromJSONLD(html string, result *VideoDetailResult) {
	// Extract upload date.
	if m := UploadDatePattern.FindStringSubmatch(html); len(m) >= 2 {
		result.PublishDate = parseUploadDate(m[1])
	}

	// Extract duration (ISO 8601 format).
	if m := JSONLDDurationPattern.FindStringSubmatch(html); len(m) >= 2 {
		durationStr, seconds := parseISODuration(m[1])
		result.Duration = durationStr
		result.DurationSec = seconds
	}

	// Extract views (userInteractionCount).
	if m := InteractionCountPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.Views = atoiSafe(m[1])
		result.ViewsText = fmt.Sprintf("%d", result.Views)
	}
}

// extractTagsFromHTML extracts video tags from the page using goquery.
func extractTagsFromHTML(html string) []string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}

	var tags []string
	seen := make(map[string]bool)

	// XVIDEOS uses multiple tag containers.
	tagSelectors := []string{
		".video-tags-list li a",
		".tags a",
		".tag-list a",
		"a[href*='/tags/']",
	}

	for _, selector := range tagSelectors {
		doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
			text := strings.TrimSpace(s.Text())
			if text != "" && len(text) < 50 && !seen[text] {
				seen[text] = true
				tags = append(tags, text)
			}
		})
		if len(tags) > 0 {
			break
		}
	}

	// Also try meta keywords as a fallback.
	if len(tags) == 0 {
		if kw, ok := doc.Find(`meta[name="keywords"]`).Attr("content"); ok && kw != "" {
			for _, t := range strings.Split(kw, ",") {
				t = strings.TrimSpace(t)
				if t != "" && !seen[t] {
					seen[t] = true
					tags = append(tags, t)
				}
			}
		}
	}

	return tags
}

// extractVideosFromDocument extracts video metadata from a listing page document.
// XVIDEOS listing pages render video cards with predictable CSS classes.
func extractVideosFromDocument(doc *goquery.Document, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

	// XVIDEOS uses various card selectors across different page types.
	cardSelectors := []string{
		".thumb-block",
		".thumb-block .thumb",
		".video-item",
		".mozaique .thumb-block",
		"[data-id]",
	}

	for _, selector := range cardSelectors {
		doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
			video := extractVideoFromElement(s, baseURL)
			if video.EncodedID != "" && !seen[video.EncodedID] {
				seen[video.EncodedID] = true
				videos = append(videos, video)
			}
		})
		if len(videos) > 0 {
			break
		}
	}

	return videos
}

// extractVideoFromElement extracts a single video's metadata from a selection.
func extractVideoFromElement(s *goquery.Selection, baseURL string) VideoMetadata {
	var video VideoMetadata

	// Find the video link: /video.{encodedId}/{slug}
	linkElem := s.Find("a[href*='/video.']")
	if linkElem.Length() == 0 {
		// Try any link with href containing "video"
		linkElem = s.Find("a[href*='video']")
	}

	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.EncodedID = ExtractEncodedID(href)
	if video.EncodedID == "" {
		return video
	}
	video.ID = video.EncodedID
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

	// If title not found from image alt, try from title element.
	if video.Title == "" {
		titleElem := s.Find(".title, .video-title, h3, .thumb-under .title a")
		if titleElem.Length() > 0 {
			video.Title = strings.TrimSpace(titleElem.Text())
		}
	}

	// Extract duration.
	durationElem := s.Find(".duration, .video-duration, [class*='duration']")
	if durationElem.Length() > 0 {
		video.Duration = strings.TrimSpace(durationElem.Text())
	}

	// Extract views.
	viewsElem := s.Find(".views, .view-count, [class*='views']")
	if viewsElem.Length() > 0 {
		viewsText := strings.TrimSpace(viewsElem.Text())
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

	// Extract uploader/author.
	authorElem := s.Find(".uploader, .author, [class*='channel'] a, [class*='uploader'] a")
	if authorElem.Length() > 0 {
		video.Uploader = strings.TrimSpace(authorElem.Text())
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
		// Look for "Next" indicators.
		if strings.Contains(strings.ToLower(text), "next") ||
			strings.Contains(text, "›") || strings.Contains(text, "»") {
			if href, exists := s.Attr("href"); exists {
				info.HasNextPage = true
				info.NextPageURL = resolveURL(href, baseURL)
			}
		}
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
	// XVIDEOS uses URL patterns like /?k=keyword&p=2 or /best/2
	// Try replacing /page/N pattern.
	re := regexp.MustCompile(`/(\d+)(?:/?)$`)
	if re.MatchString(currentURL) {
		return re.ReplaceAllString(currentURL, fmt.Sprintf("/%d", nextPage))
	}
	// Try replacing ?p=N pattern.
	if strings.Contains(currentURL, "p=") {
		re := regexp.MustCompile(`p=\d+`)
		return re.ReplaceAllString(currentURL, fmt.Sprintf("p=%d", nextPage))
	}
	// If URL ends with /, append page number.
	if strings.HasSuffix(currentURL, "/") {
		return currentURL + fmt.Sprintf("%d", nextPage)
	}
	// If URL has query string, append &p=N.
	if strings.Contains(currentURL, "?") {
		return currentURL + "&p=" + fmt.Sprintf("%d", nextPage)
	}
	return currentURL + "/" + fmt.Sprintf("%d", nextPage)
}


