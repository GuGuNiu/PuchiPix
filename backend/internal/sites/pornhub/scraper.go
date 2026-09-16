package pornhub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var scraperLogger = infra.NewLogger("PornhubScraper")

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in PORNHUB video pages.
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
// the HLS M3U8 URL and MP4 direct links from the inline flashvars JSON
// object embedded in the page HTML. This is the primary scraping method
// for PORNHUB since the site embeds the video stream URLs directly in
// server-rendered HTML without requiring JavaScript execution.
//
// Extraction strategy:
//  1. Fetch page HTML via HTTP GET
//  2. Regex match "hlsUrl" inside the playerObjectList/flashvars block for M3U8
//  3. Regex match "quality_1080p"..."quality_240p" for MP4 direct links
//  4. Parse JSON-LD for structured metadata (title, views, date, duration)
//  5. Fall back to og: meta tags for title and thumbnail
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	viewKey := ExtractViewKey(pageURL)

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:       viewKey,
			ViewKey:  viewKey,
			PageURL:  pageURL,
		},
	}

	// Extract M3U8 and MP4 URLs from the flashvars JSON block.
	extractMediaURLs(html, result)

	// Try to extract title from JSON-LD first, then fall back to og:title.
	result.Title = extractTitle(html)

	// Extract thumbnail from og:image or JSON-LD thumbnailUrl.
	result.ThumbnailURL = extractThumbnail(html)

	// Extract views, duration, and publish date from JSON-LD.
	extractMetadataFromJSONLD(html, result)

	// Extract uploader and tags from the page.
	result.Uploader = extractUploader(html)
	result.Tags = extractTagsFromHTML(html)

	if result.M3U8URL == "" && result.MP4URL == "" {
		return nil, fmt.Errorf("no video source found on page (possible age gate or region block): %s", pageURL)
	}

	scraperLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":        pageURL,
			"viewKey":    viewKey,
			"m3u8Found":  result.M3U8URL != "",
			"mp4Found":   result.MP4URL != "",
			"title":      result.Title,
			"uploader":   result.Uploader,
			"views":      result.Views,
			"tagsCount":  len(result.Tags),
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
// PORNHUB aggressively filters non-browser requests, so a stealth client
// with browser-like headers is required to avoid HTTP 403 responses.
func fetchPageHTML(ctx context.Context, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	profile := stealth.RandomProfile()
	req.Header.Set("User-Agent", profile.UA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

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

// extractMediaURLs extracts the HLS M3U8 URL and MP4 direct links from
// the flashvars/playerObjectList JSON embedded in the page.
func extractMediaURLs(html string, result *VideoDetailResult) {
	// The flashvars JSON lives either inside playerObjectList or in a
	// "mediaDefinition" array. Search the whole HTML for hlsUrl first.
	if m := HLSURLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.M3U8URL = unescapeJSONString(m[1])
	}

	// Collect all MP4 quality links from flashvars: "quality_1080p":"..."
	links := make(map[string]string)
	for _, m := range MP4QualityPattern.FindAllStringSubmatch(html, -1) {
		if len(m) >= 3 {
			quality := strings.TrimSuffix(m[1], "p")
			url := unescapeJSONString(m[2])
			if url != "" && !strings.Contains(url, "deleted") {
				links[quality] = url
			}
		}
	}
	if len(links) > 0 {
		result.MP4Links = links
		// Prefer the highest available quality as the primary MP4.
		result.MP4URL = pickBestQuality(links)
	}

	// Fallback: some pages embed a single "mediaUrl" for MP4.
	if result.MP4URL == "" {
		re := regexp.MustCompile(`"mediaUrl"\s*:\s*"([^"]+)"`)
		if m := re.FindStringSubmatch(html); len(m) >= 2 {
			result.MP4URL = unescapeJSONString(m[1])
		}
	}
}

// pickBestQuality selects the highest-resolution URL from a quality map.
func pickBestQuality(links map[string]string) string {
	best := ""
	bestNum := -1
	for quality, url := range links {
		n, err := strconv.Atoi(quality)
		if err != nil {
			continue
		}
		if n > bestNum {
			bestNum = n
			best = url
		}
	}
	return best
}

// unescapeJSONString decodes common JSON string escapes (\/ and \u002F)
// found inside raw HTML-embedded JSON values.
func unescapeJSONString(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var out string
	if err := json.Unmarshal([]byte(`"`+s+`"`), &out); err != nil {
		// Last resort: manual replacement of common escapes.
		return strings.ReplaceAll(strings.ReplaceAll(s, `\/`, "/"), `\u002F`, "/")
	}
	return out
}

// extractTitle extracts the video title from JSON-LD or og:title meta tag.
func extractTitle(html string) string {
	// Try JSON-LD name field first.
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

	// Try og:title meta tag.
	if m := VideoTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	// Try JSON-LD name via regex fallback.
	if m := JSONLDNamePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	return ""
}

// extractThumbnail extracts the thumbnail URL from og:image or JSON-LD.
func extractThumbnail(html string) string {
	if m := ThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}
	if m := regexp.MustCompile(`"thumbnailUrl"\s*:\s*\[?"([^"]+)"\]?`).FindStringSubmatch(html); len(m) >= 2 {
		return unescapeJSONString(m[1])
	}
	return ""
}

// extractUploader extracts the uploader/model/channel name from the page.
func extractUploader(html string) string {
	// JSON-LD author field: "author":"Model Name" or nested object.
	re := regexp.MustCompile(`"author"\s*:\s*(?:"([^"]+)"|\[\{"name"\s*:\s*"([^"]+)"\}\])`)
	if m := re.FindStringSubmatch(html); len(m) >= 2 {
		if m[1] != "" {
			return m[1]
		}
		if len(m) >= 3 && m[2] != "" {
			return m[2]
		}
	}

	// CSS selector fallback on the rendered page.
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return ""
	}
	uploader := doc.Find(".usernameBadge, .userInfo a, .video-distributor a, .creator a").First().Text()
	return strings.TrimSpace(uploader)
}

// extractMetadataFromJSONLD extracts views, duration, and publish date
// from JSON-LD structured data using regex patterns.
func extractMetadataFromJSONLD(html string, result *VideoDetailResult) {
	if m := UploadDatePattern.FindStringSubmatch(html); len(m) >= 2 {
		result.PublishDate = parseUploadDate(m[1])
	}

	if m := JSONLDDurationPattern.FindStringSubmatch(html); len(m) >= 2 {
		durationStr, seconds := parseISODuration(m[1])
		result.Duration = durationStr
		result.DurationSec = seconds
	}

	if m := InteractionCountPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.Views = atoiSafe(m[1])
		result.ViewsText = strconv.Itoa(result.Views)
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

	tagSelectors := []string{
		".tagsWrapper a",
		".video-detailed-info .tags a",
		"a[href*='?tags=']",
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

	return tags
}

// extractVideosFromDocument extracts video metadata from a listing page
// document. PORNHUB listing pages render video cards with predictable
// CSS classes and data attributes.
func extractVideosFromDocument(doc *goquery.Document, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

	// PORNHUB uses .videoBox on both legacy and modern listing pages.
	cardSelectors := []string{
		"li.videoBox",
		".videoBox",
		"[data-video-vkey]",
	}

	for _, selector := range cardSelectors {
		doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
			video := extractVideoFromElement(s, baseURL)
			if video.ViewKey != "" && !seen[video.ViewKey] {
				seen[video.ViewKey] = true
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

	// Prefer the data attribute: data-video-vkey="ph..."
	if vkey, exists := s.Attr("data-video-vkey"); exists && vkey != "" {
		video.ViewKey = vkey
	} else if vkey, exists := s.Find("[data-video-vkey]").First().Attr("data-video-vkey"); exists && vkey != "" {
		video.ViewKey = vkey
	}

	// Find the detail page link: /view_video.php?viewkey=... or /watch/...
	linkElem := s.Find("a[href*='viewkey=']").First()
	if linkElem.Length() == 0 {
		linkElem = s.Find("a[href*='/watch/']").First()
	}
	if linkElem.Length() == 0 {
		// Try the card itself as a link wrapper.
		linkElem = s.Filter("a[href*='viewkey=']").First()
	}

	if href, exists := linkElem.Attr("href"); exists && href != "" {
		if video.ViewKey == "" {
			video.ViewKey = ExtractViewKey(href)
		}
		video.PageURL = resolveURL(href, baseURL)
	}

	if video.ViewKey == "" {
		return video
	}
	video.ID = video.ViewKey

	// Extract thumbnail.
	imgElem := s.Find("img").First()
	if imgElem.Length() > 0 {
		video.ThumbnailURL, _ = imgElem.Attr("data-thumb_url")
		if video.ThumbnailURL == "" {
			video.ThumbnailURL, _ = imgElem.Attr("data-src")
		}
		if video.ThumbnailURL == "" {
			video.ThumbnailURL, _ = imgElem.Attr("src")
		}
		video.Title, _ = imgElem.Attr("alt")
	}

	// Title fallback: the card title element or link title attribute.
	if video.Title == "" {
		if title, exists := linkElem.Attr("title"); exists && title != "" {
			video.Title = title
		}
	}
	if video.Title == "" {
		titleElem := s.Find(".title a, .videoTitle, .title").First()
		if titleElem.Length() > 0 {
			video.Title = strings.TrimSpace(titleElem.Text())
		}
	}

	// Extract duration from the badge: <var class="duration">11:30</var>.
	durationElem := s.Find("var.duration, .duration, .marker-overlap var").First()
	if durationElem.Length() > 0 {
		durationText := strings.TrimSpace(durationElem.Text())
		if durationText != "" {
			video.Duration = durationText
			video.DurationSec = parseClockDuration(durationText)
		}
	}

	// Extract views text.
	viewsElem := s.Find(".views var").First()
	if viewsElem.Length() > 0 {
		viewsText := strings.TrimSpace(viewsElem.Text())
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

	// Extract uploader/author.
	authorElem := s.Find(".username a, .username, .author").First()
	if authorElem.Length() > 0 {
		video.Uploader = strings.TrimSpace(authorElem.Text())
	}

	return video
}

// parseClockDuration parses "HH:MM:SS" or "MM:SS" into seconds.
func parseClockDuration(text string) int {
	parts := strings.Split(strings.TrimSpace(text), ":")
	if len(parts) == 0 || len(parts) > 3 {
		return 0
	}
	total := 0
	for _, p := range parts {
		n := atoiSafe(strings.TrimSpace(p))
		total = total*60 + n
	}
	return total
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

	pagination := doc.Find(".pagination, .pager, [class*='pagination'], [class*='pageNextPrevWrapper']")
	if pagination.Length() == 0 {
		return info
	}

	activePage := pagination.Find(".active, .current, li[class*='active']")
	if activePage.Length() > 0 {
		pageText := strings.TrimSpace(activePage.First().Text())
		info.CurrentPage = atoiSafe(pageText)
	}

	maxPage := info.CurrentPage
	pagination.Find("a").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		href, exists := s.Attr("href")
		lower := strings.ToLower(text)
		if strings.Contains(lower, "next") || strings.Contains(text, "›") || strings.Contains(text, "»") {
			if exists && href != "" {
				info.HasNextPage = true
				info.NextPageURL = resolveURL(href, baseURL)
			}
		}
		if pageNum := atoiSafe(text); pageNum > maxPage {
			maxPage = pageNum
		}
	})

	info.TotalPages = maxPage

	// Pornhub search pages use ?page=N; build the next page URL if the
	// pager only rendered page numbers without an explicit next link.
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

// buildNextPageURL constructs the next page URL based on the current URL
// pattern. PORNHUB pagination uses ?page=N on search/category pages.
func buildNextPageURL(currentURL string, nextPage int) string {
	pageParam := regexp.MustCompile(`([?&])page=\d+`)
	if pageParam.MatchString(currentURL) {
		return pageParam.ReplaceAllString(currentURL, "${1}page="+strconv.Itoa(nextPage))
	}
	if strings.Contains(currentURL, "?") {
		return currentURL + "&page=" + strconv.Itoa(nextPage)
	}
	return currentURL + "?page=" + strconv.Itoa(nextPage)
}

// htmlUnescape decodes the most common HTML entities found in meta tags.
func htmlUnescape(s string) string {
	replacements := []struct{ from, to string }{
		{"&amp;", "&"},
		{"&lt;", "<"},
		{"&gt;", ">"},
		{"&quot;", "\""},
		{"&#39;", "'"},
		{"&#039;", "'"},
	}
	for _, r := range replacements {
		s = strings.ReplaceAll(s, r.from, r.to)
	}
	return s
}
