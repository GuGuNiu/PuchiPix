package porn91

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/xutil"
)

var scraperLogger = infra.NewLogger("Porn91Scraper")

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in 91porn.plus video pages.
//
// Author is untyped because the site emits it as a nested Person object;
// declaring it as a string would abort the decode of the whole object and
// cost the stream URL along with the author.
type jsonLDVideoObject struct {
	Type        string `json:"@type"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// URL is the canonical page address. Listing entries carry it, and on a
	// detail page it duplicates contentUrl's sibling information while
	// contentUrl itself holds the stream.
	URL                  string     `json:"url"`
	ThumbnailURL         stringList `json:"thumbnailUrl"`
	UploadDate           string     `json:"uploadDate"`
	Duration             string     `json:"duration"`
	ContentURL           string     `json:"contentUrl"`
	Author               any        `json:"author"`
	InteractionStatistic struct {
		Type            string `json:"@type"`
		InteractionType struct {
			Type string `json:"@type"`
		} `json:"interactionType"`
		UserInteractionCount int `json:"userInteractionCount"`
	} `json:"interactionStatistic"`
}

// stringList accepts a JSON value that the site emits either as a bare
// string or as an array of strings.
//
// The same field is published in both forms: thumbnailUrl is an array on a
// detail page and a plain string on a listing entry. A typed slice field
// cannot decode the string form, and encoding/json abandons the entire
// enclosing object when it hits the mismatch, which loses every entry in the
// list rather than one field.
type stringList []string

// UnmarshalJSON decodes either representation into a string slice.
func (s *stringList) UnmarshalJSON(data []byte) error {
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*s = stringList{single}
		return nil
	}

	var many []string
	if err := json.Unmarshal(data, &many); err != nil {
		return err
	}
	*s = many
	return nil
}

// jsonLDGraph is the wrapper the site puts its structured data in: the
// script's top-level type is absent and the members sit inside @graph.
type jsonLDGraph struct {
	Type  string            `json:"@type"`
	Graph []json.RawMessage `json:"@graph"`
}

// jsonLDItemList is the listing shape: a graph member of type ItemList whose
// entries each wrap a VideoObject.
type jsonLDItemList struct {
	Type            string `json:"@type"`
	ItemListElement []struct {
		Position int               `json:"position"`
		Item     jsonLDVideoObject `json:"item"`
	} `json:"itemListElement"`
}

// ScrapeDetailHTTP extracts the M3U8 URL and metadata from the Schema.org
// JSON-LD block of a server-rendered detail page.
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	return ScrapeDetailFromHTML(html, pageURL)
}

// ScrapeDetailFromHTML parses a detail page that has already been fetched.
func ScrapeDetailFromHTML(html, pageURL string) (*VideoDetailResult, error) {
	videoObj, err := extractJSONLDVideoObject(html)
	if err != nil {
		return nil, fmt.Errorf("JSON-LD extraction failed: %w", err)
	}

	videoID := ExtractVideoID(pageURL)

	thumbnailURL := ""
	if len(videoObj.ThumbnailURL) > 0 {
		thumbnailURL = videoObj.ThumbnailURL[0]
	}
	if thumbnailURL == "" {
		if m := OGImagePattern.FindStringSubmatch(html); len(m) >= 2 {
			thumbnailURL = m[1]
		}
	}

	title := videoObj.Name
	if title == "" {
		if m := OGTitlePattern.FindStringSubmatch(html); len(m) >= 2 {
			title = m[1]
		}
	}

	duration, durationSec := parseISODurationSeconds(videoObj.Duration)

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:           videoID,
			Title:        title,
			PageURL:      pageURL,
			ThumbnailURL: thumbnailURL,
			Views:        videoObj.InteractionStatistic.UserInteractionCount,
			ViewsText:    fmt.Sprintf("%d", videoObj.InteractionStatistic.UserInteractionCount),
			Duration:     duration,
			DurationSec:  durationSec,
			PublishDate:  parseUploadDate(videoObj.UploadDate),
			Author:       jsonLDAuthorName(videoObj.Author),
			Tags:         extractTags(html),
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
			"author":    result.Author,
			"views":     result.Views,
			"tagsCount": len(result.Tags),
		}})

	return result, nil
}

// extractTags reads the keywords meta tag, the only structured tag source
// the site publishes. The site's own SEO keywords are filtered out because
// they appear on every page and describe the site rather than the video.
func extractTags(html string) []string {
	m := MetaKeywordsPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		return nil
	}

	var tags []string
	seen := make(map[string]bool)

	for _, raw := range strings.Split(m[1], ",") {
		tag := strings.TrimSpace(htmlUnescape(raw))
		if tag == "" || len(tag) >= 50 || seen[tag] || isBrandKeyword(tag) {
			continue
		}
		seen[tag] = true
		tags = append(tags, tag)
	}

	return tags
}

func isBrandKeyword(tag string) bool {
	lowered := strings.ToLower(tag)
	for _, prefix := range brandKeywordPrefixes {
		if strings.HasPrefix(lowered, prefix) {
			return true
		}
	}
	return false
}

// jsonLDAuthorName normalizes the author field, which is a nested Person
// object on the current pages.
func jsonLDAuthorName(author any) string {
	switch v := author.(type) {
	case string:
		return strings.TrimSpace(v)
	case map[string]any:
		if name, ok := v["name"].(string); ok && name != "" {
			return strings.TrimSpace(name)
		}
	case []any:
		for _, entry := range v {
			if name := jsonLDAuthorName(entry); name != "" {
				return name
			}
		}
	}
	return ""
}

// ToScrapeResult maps a detail scrape onto the pipeline's result shape. The
// author is only used as an actor when present, so an unknown uploader never
// becomes a one-element slice holding "".
func (r *VideoDetailResult) ToScrapeResult(pageURL string) *sites.ScrapeResult {
	out := &sites.ScrapeResult{
		M3U8URL: r.M3U8URL,
		Title:   r.Title,
		PageURL: pageURL,
		Tags:    r.Tags,
	}
	if r.Author != "" {
		out.Actors = []string{r.Author}
	}
	return out
}

// ScrapeDetailAsScrapeResult scrapes a video detail page and converts the
// result to a sites.ScrapeResult for the video pipeline.
func ScrapeDetailAsScrapeResult(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	detail, err := ScrapeDetailHTTP(ctx, pageURL)
	if err != nil {
		return nil, err
	}
	return detail.ToScrapeResult(pageURL), nil
}

func ScrapeListingHTTP(ctx context.Context, listingURL string) (*ListingPageResult, error) {
	scraperLogger.Info("Scraping listing page",
		infra.LogContext{Extra: map[string]any{
			"url": listingURL,
		}})

	html, err := fetchPageHTML(ctx, listingURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	result, err := ScrapeListingFromHTML(html, listingURL)
	if err != nil {
		return nil, err
	}

	scraperLogger.Info("Listing scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":         listingURL,
			"videosFound": len(result.Videos),
			"currentPage": result.CurrentPage,
			"hasNextPage": result.HasNextPage,
		}})

	return result, nil
}

// ScrapeListingFromHTML parses a listing page that has already been fetched.
func ScrapeListingFromHTML(html, listingURL string) (*ListingPageResult, error) {
	// Card hrefs are site-absolute, so they must be resolved against the
	// origin rather than against the listing URL, which would prefix the
	// listing path onto every card link.
	baseURL := extractBaseURL(listingURL)

	// The structured listing is authoritative: the page ships no card markup
	// at all, so the card parser is kept only as a fallback for a template
	// that renders them server-side.
	videos := extractListingFromJSONLD(html, baseURL)
	usedStructured := len(videos) > 0
	if !usedStructured {
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			return nil, fmt.Errorf("failed to parse HTML: %w", err)
		}
		videos = extractVideosFromDocument(doc, baseURL)
	}

	pagination := extractPaginationFromDocument(docOrNil(html), listingURL, baseURL)

	result := &ListingPageResult{
		Videos:      videos,
		TotalPages:  pagination.TotalPages,
		CurrentPage: pagination.CurrentPage,
		HasNextPage: pagination.HasNextPage || len(videos) >= fullListingPageSize,
		NextPageURL: pagination.NextPageURL,
	}

	// The pager is rendered on the client, so the markup parser picks up
	// unrelated numbers from the response. When the structured listing is
	// in use the page index is taken from the URL, which is authoritative,
	// and the total is left unknown rather than guessed.
	if len(videos) > 0 && usedStructured {
		result.CurrentPage = pageFromURL(listingURL)
		result.TotalPages = 0
		if result.CurrentPage > 0 && result.HasNextPage {
			result.NextPageURL = fmt.Sprintf("%s?page=%d", listingPath(listingURL), result.CurrentPage+1)
		}
	}

	return result, nil
}

// pageFromURL reads the 1-based page index from a listing URL, defaulting
// to the first page.
func pageFromURL(listingURL string) int {
	parsed, err := url.Parse(listingURL)
	if err != nil {
		return 1
	}
	if n := atoiSafe(parsed.Query().Get("page")); n > 0 {
		return n
	}
	return 1
}

// listingPath returns a listing URL without its query string, so a rebuilt
// next-page link does not accumulate parameters.
func listingPath(listingURL string) string {
	parsed, err := url.Parse(listingURL)
	if err != nil {
		return listingURL
	}
	parsed.RawQuery = ""
	return strings.TrimSuffix(parsed.String(), "/")
}

// fullListingPageSize is the number of entries the site publishes per
// listing page. A full page means there is very likely another one, because
// the pager is rendered on the client and leaves no next-page marker in the
// server response.
const fullListingPageSize = 24

func docOrNil(html string) *goquery.Document {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}
	return doc
}

// fetchPageHTML performs an HTTP GET and returns the raw HTML body. The
// full browser header set is required: the site is an Angular SPA whose
// index is served to any client, but it only renders the video data into
// the server response for one that looks like a browser.
func fetchPageHTML(ctx context.Context, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	profile := stealth.RandomProfile()
	for k, v := range stealth.DocumentRequestHeaders(&profile, extractBaseURL(pageURL)+"/") {
		req.Header.Set(k, v)
	}

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

// htmlUnescape decodes the HTML entities the site emits in titles and meta
// tags, then normalizes the result through the shared text cleaner.
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
	return xutil.CleanText(s)
}

// extractJSONLDVideoObject finds the VideoObject on the page and returns it.
//
// The site does not publish the video as a standalone JSON-LD block: the
// script's top-level type is BreadcrumbList and the video is a member of its
// @graph array, so the graph is walked as well. Matching only on a
// top-level VideoObject is what previously forced the parser onto the
// raw-HTML fallback, which picked the breadcrumb's name as the title.
func extractJSONLDVideoObject(html string) (*jsonLDVideoObject, error) {
	blocks := JSONLDVideoObjectPattern.FindAllStringSubmatch(html, -1)
	if len(blocks) == 0 {
		return extractVideoFromRawHTML(html)
	}

	for _, block := range blocks {
		if len(block) < 2 {
			continue
		}
		rawJSON := strings.TrimSpace(block[1])
		if rawJSON == "" {
			continue
		}

		if obj, ok := decodeVideoObject(rawJSON); ok {
			return obj, nil
		}
	}

	return extractVideoFromRawHTML(html)
}

// decodeVideoObject parses one JSON-LD block, accepting the video either as
// the block itself or as a direct member of its @graph array.
func decodeVideoObject(rawJSON string) (*jsonLDVideoObject, bool) {
	var obj jsonLDVideoObject
	if err := json.Unmarshal([]byte(rawJSON), &obj); err == nil && obj.Type == "VideoObject" && obj.ContentURL != "" {
		return &obj, true
	}

	var wrapper jsonLDGraph
	if err := json.Unmarshal([]byte(rawJSON), &wrapper); err != nil {
		return nil, false
	}
	for _, member := range wrapper.Graph {
		var candidate jsonLDVideoObject
		if err := json.Unmarshal(member, &candidate); err != nil {
			continue
		}
		if candidate.Type == "VideoObject" && candidate.ContentURL != "" {
			return &candidate, true
		}
	}

	return nil, false
}

// extractListingFromJSONLD reads the listing entries the site publishes as
// structured data.
//
// This is the only usable listing source: the page is an Angular shell whose
// cards are rendered on the client, so the card markup is absent from the
// server response and no CSS selector can match it. The videos are published
// as an ItemList member of the JSON-LD graph, one level deeper than the
// detail page's VideoObject.
func extractListingFromJSONLD(html, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

	for _, m := range JSONLDVideoObjectPattern.FindAllStringSubmatch(html, -1) {
		if len(m) < 2 {
			continue
		}
		var wrapper jsonLDGraph
		if err := json.Unmarshal([]byte(strings.TrimSpace(m[1])), &wrapper); err != nil {
			continue
		}

		for _, member := range wrapper.Graph {
			var list jsonLDItemList
			if err := json.Unmarshal(member, &list); err != nil || list.Type != "ItemList" {
				continue
			}
			for _, entry := range list.ItemListElement {
				item := entry.Item
				id := ExtractVideoID(item.URL)
				if id == "" || seen[id] {
					continue
				}
				seen[id] = true

				video := VideoMetadata{
					ID:          id,
					Title:       item.Name,
					PageURL:     resolveURL(item.URL, baseURL),
					PublishDate: parseUploadDate(item.UploadDate),
				}
				video.Duration, video.DurationSec = parseISODurationSeconds(item.Duration)
				if len(item.ThumbnailURL) > 0 {
					video.ThumbnailURL = item.ThumbnailURL[0]
				}
				videos = append(videos, video)
			}
		}
	}

	return videos
}

// extractVideoFromRawHTML pulls the M3U8 URL and basic metadata straight out
// of the markup when the JSON-LD block cannot be parsed.
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

// extractVideosFromDocument reads video cards from a listing page.
//
// As an Angular SPA the site renders cards client-side, so the generic selector
// list is tried in order and an ItemList JSON-LD block is used as fallback.
func extractVideosFromDocument(doc *goquery.Document, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

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
		if len(videos) > 0 {
			break
		}
	}

	if len(videos) == 0 {
		doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
			content := strings.TrimSpace(s.Text())
			if content == "" {
				return
			}
			var itemList struct {
				Type            string `json:"@type"`
				ItemListElement []struct {
					Type string            `json:"@type"`
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

func extractVideoFromElement(s *goquery.Selection, baseURL string) VideoMetadata {
	var video VideoMetadata

	linkElem := s.Find("a[href*='/video/']")
	if linkElem.Length() == 0 {
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

	if video.Title == "" {
		titleElem := s.Find(".title, .video-title, h3, h4")
		if titleElem.Length() > 0 {
			video.Title = strings.TrimSpace(titleElem.Text())
		}
	}

	viewsElem := s.Find(".views, .view-count, [class*='view']")
	if viewsElem.Length() > 0 {
		viewsText := strings.TrimSpace(viewsElem.Text())
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

	durationElem := s.Find(".duration, .time, [class*='duration']")
	if durationElem.Length() > 0 {
		video.Duration = strings.TrimSpace(durationElem.Text())
	}

	authorElem := s.Find(".author, .uploader, [class*='author']")
	if authorElem.Length() > 0 {
		video.Author = strings.TrimSpace(authorElem.Text())
	}

	return video
}

type PaginationInfo struct {
	TotalPages  int
	CurrentPage int
	HasNextPage bool
	NextPageURL string
}

func extractPaginationFromDocument(doc *goquery.Document, currentURL string, baseURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	pagination := doc.Find(".pagination, .pager, [class*='pagination'], [class*='pager']")
	if pagination.Length() == 0 {
		return info
	}

	activePage := pagination.Find(".active, .current")
	if activePage.Length() > 0 {
		pageText := strings.TrimSpace(activePage.Text())
		info.CurrentPage = atoiSafe(pageText)
	}

	maxPage := info.CurrentPage
	pagination.Find("a").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		if strings.Contains(text, "Next") || strings.Contains(text, "下一页") ||
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

	// Derive the next page from the pager window when no explicit next link
	// was rendered
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		info.NextPageURL = buildNextPageURL(currentURL, info.CurrentPage+1)
	}

	return info
}

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

func buildNextPageURL(currentURL string, nextPage int) string {
	// 91porn.plus uses URL patterns like /category/1/latest/2
	re := regexp.MustCompile(`/(\d+)(?:/?)$`)
	if re.MatchString(currentURL) {
		return re.ReplaceAllString(currentURL, fmt.Sprintf("/%d", nextPage))
	}
	if strings.HasSuffix(currentURL, "/") {
		return currentURL + fmt.Sprintf("%d", nextPage)
	}
	return currentURL + "/" + fmt.Sprintf("%d", nextPage)
}
