package xvideos

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
	"backend/internal/xutil"
)

var scraperLogger = infra.NewLogger("XvideosScraper")

var (
	tagPattern   = regexp.MustCompile(`<[^>]*>`)
	spacePattern = regexp.MustCompile(`\s+`)
)

// playerConfig is the third constructor argument of new HTML5Player. It is
// the only structured source for the site's own category taxonomy and
// keyword tags, and it is always present on a real detail page.
type playerConfig struct {
	Categories string `json:"categories"`
	Keywords   string `json:"keywords"`
	Tracker    string `json:"tracker"`
	IsChannel  int    `json:"is_channel"`
}

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in XVIDEOS video pages.
type jsonLDVideoObject struct {
	Type                 string   `json:"@type"`
	Name                 string   `json:"name"`
	Description          string   `json:"description"`
	ThumbnailURL         []string `json:"thumbnailUrl"`
	UploadDate           string   `json:"uploadDate"`
	Duration             string   `json:"duration"`
	Author               any      `json:"author"`
	InteractionStatistic []struct {
		UserInteractionCount int `json:"userInteractionCount"`
	} `json:"interactionStatistic"`
}

// ScrapeDetailHTTP extracts the HLS M3U8 URL and MP4 direct link from the
// inline html5player <script> calls of a server-rendered detail page, then
// fills metadata from the player config, the label list and the OG meta tags.
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	// A removed, private or region-blocked video serves a banner instead of
	// the player. Reporting the banner text beats "no video source found".
	if m := InlineErrorPattern.FindStringSubmatch(html); len(m) >= 2 {
		return nil, fmt.Errorf("XVIDEOS said: %s", strings.TrimSpace(htmlUnescape(m[1])))
	}

	encodedID := ExtractEncodedID(pageURL)

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:        encodedID,
			EncodedID: encodedID,
			PageURL:   pageURL,
		},
	}

	if m := HLSURLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.M3U8URL = m[1]
		if uuidMatch := VideoUUIDPattern.FindStringSubmatch(result.M3U8URL); len(uuidMatch) >= 2 {
			result.VideoUUID = uuidMatch[1]
		}
	} else if m := LegacyFLVURLPattern.FindStringSubmatch(html); len(m) >= 2 {
		// Legacy pages publish a single progressive stream in a query
		// string rather than through the player API.
		result.MP4URL = m[1]
	}

	if m := MP4URLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.MP4URL = m[1]
	}

	if m := CDNIDPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.CDNID = m[1]
	}

	if m := UploaderPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.Uploader = m[1]
	}

	if m := EncodedIDScriptPattern.FindStringSubmatch(html); len(m) >= 2 && result.EncodedID == "" {
		result.EncodedID = m[1]
		result.ID = m[1]
	}

	result.Title = extractTitle(html, pageURL)
	result.ThumbnailURL = extractThumbnail(html)
	extractMetadataFromJSONLD(html, result)
	extractPlayerMetadata(html, result)

	scraperLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":        pageURL,
			"videoId":    encodedID,
			"m3u8Found":  result.M3U8URL != "",
			"mp4Found":   result.MP4URL != "",
			"title":      result.Title,
			"uploader":   result.Uploader,
			"views":      result.Views,
			"tagsCount":  len(result.Tags),
			"catsCount":  len(result.Categories),
			"starsCount": len(result.Pornstars),
		}})

	if result.M3U8URL == "" && result.MP4URL == "" {
		return nil, fmt.Errorf("no video source found on page: %s", pageURL)
	}

	return result, nil
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

// ToScrapeResult maps a detail scrape onto the pipeline's result shape.
// Actors come from the site's pornstar list; the uploader is a channel and is
// only used when no performer is credited, and an empty value never becomes a
// one-element slice holding "".
func (r *VideoDetailResult) ToScrapeResult(pageURL string) *sites.ScrapeResult {
	out := &sites.ScrapeResult{
		M3U8URL: r.M3U8URL,
		Title:   r.Title,
		PageURL: pageURL,
		Tags:    r.Tags,
	}

	actors := r.Pornstars
	if len(actors) == 0 && r.Uploader != "" {
		actors = []string{r.Uploader}
	}
	if len(actors) > 0 {
		out.Actors = actors
	}

	if len(r.Categories) > 0 {
		out.Categories = r.Categories
	}

	return out
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
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	// Card hrefs are site-absolute, so they must be resolved against the
	// origin. Using the listing URL itself would prefix the listing path
	// onto every card link.
	baseURL := extractBaseURL(listingURL)
	videos := extractVideosFromDocument(doc, baseURL)
	pagination := extractPaginationFromDocument(doc, listingURL, baseURL)

	return &ListingPageResult{
		Videos:      videos,
		TotalPages:  pagination.TotalPages,
		CurrentPage: pagination.CurrentPage,
		HasNextPage: pagination.HasNextPage,
		NextPageURL: pagination.NextPageURL,
	}, nil
}

// fetchPageHTML performs an HTTP GET request and returns the raw HTML body.
// The full browser header set is required: XVIDEOS serves a stripped-down
// page to clients that omit the client-hint and fetch-metadata headers, in
// which case the html5player configuration is absent.
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

// parseJSONLD returns the first Schema.org VideoObject block on the page.
func parseJSONLD(html string) *jsonLDVideoObject {
	for _, m := range JSONLDVideoObjectPattern.FindAllStringSubmatch(html, -1) {
		if len(m) < 2 {
			continue
		}
		raw := strings.TrimSpace(m[1])
		if raw == "" {
			continue
		}
		var obj jsonLDVideoObject
		if err := json.Unmarshal([]byte(raw), &obj); err != nil {
			continue
		}
		if obj.Type == "" || obj.Type == "VideoObject" {
			return &obj
		}
	}
	return nil
}

func extractTitle(html, pageURL string) string {
	if obj := parseJSONLD(html); obj != nil && obj.Name != "" {
		return htmlUnescape(obj.Name)
	}

	if m := VideoTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	if m := OGTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	// The page heading is the last structured source; its duration and
	// resolution spans are dropped along with the markup.
	if m := PageTitlePattern.FindStringSubmatch(html); len(m) >= 2 {
		if text := headingText(m[1]); text != "" {
			return htmlUnescape(text)
		}
	}

	if m := JSONLDNamePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	return ""
}

// headingText extracts the text of a title element while discarding nested
// spans, which carry the duration and resolution badges rather than title
// text. Reading the flattened text would append "7 min720p" to the title.
func headingText(fragment string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader("<div>" + fragment + "</div>"))
	if err != nil {
		return ""
	}
	wrap := doc.Find("div").First()
	wrap.Find("span, var").Remove()
	return strings.TrimSpace(collapseSpaces(wrap.Text()))
}

func extractThumbnail(html string) string {
	if m := OGImagePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	if m := JSONLDThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	if m := ThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return m[1]
	}

	return ""
}

func extractMetadataFromJSONLD(html string, result *VideoDetailResult) {
	if obj := parseJSONLD(html); obj != nil {
		if obj.UploadDate != "" {
			result.PublishDate = parseUploadDate(obj.UploadDate)
		}
		if obj.Duration != "" {
			durationStr, seconds := parseISODuration(obj.Duration)
			result.Duration = durationStr
			result.DurationSec = seconds
		}
		if len(obj.InteractionStatistic) > 0 {
			result.Views = obj.InteractionStatistic[0].UserInteractionCount
			result.ViewsText = strconv.Itoa(result.Views)
		}
	}

	// og:duration is published in whole seconds and is present even when
	// the page carries no JSON-LD.
	if result.DurationSec == 0 {
		if m := OGDurationPattern.FindStringSubmatch(html); len(m) >= 2 {
			if sec := atoiSafe(m[1]); sec > 0 {
				result.DurationSec = sec
				result.Duration = fmtDuration(sec/3600, (sec%3600)/60, sec%60)
			}
		}
	}

	if result.PublishDate == "" {
		if m := UploadDateScriptPattern.FindStringSubmatch(html); len(m) >= 2 {
			result.PublishDate = parseUploadDate(m[1])
		}
	}

	if result.Views == 0 {
		result.ViewsText, result.Views = extractViewsFromActionBar(html)
	}
}

// extractViewsFromActionBar reads the view counter. The counter is rendered
// twice, once exact for desktop and once abbreviated for mobile, so only the
// exact element is read: parsing both would concatenate "1,898" and "2k"
// into a wrong count.
func extractViewsFromActionBar(html string) (string, int) {
	m := ViewsBlockPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		return "", 0
	}
	block := m[1]

	if exact := ViewsExactPattern.FindStringSubmatch(block); len(exact) >= 2 {
		return exact[1], ExtractViews(exact[1])
	}
	if first := ViewsFallbackPattern.FindStringSubmatch(block); len(first) >= 2 {
		return first[1], ExtractViews(first[1])
	}
	return "", 0
}

// extractPlayerMetadata fills categories, tags and performers from the
// sources the site itself publishes: the player config object for the
// category taxonomy and keyword tags, and the label list for the credited
// pornstars.
func extractPlayerMetadata(html string, result *VideoDetailResult) {
	if cfg := parsePlayerConfig(html); cfg != nil {
		result.Categories = splitCSVFields(cfg.Categories)
		result.Tags = splitCSVFields(cfg.Keywords)
	}

	if result.Pornstars == nil {
		result.Pornstars = extractPornstars(html)
	}
}

// parsePlayerConfig decodes the HTML5Player configuration object.
func parsePlayerConfig(html string) *playerConfig {
	m := PlayerConfigPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		return nil
	}
	var cfg playerConfig
	if err := json.Unmarshal([]byte(m[1]), &cfg); err != nil {
		return nil
	}
	return &cfg
}

// splitCSVFields splits a comma-separated config field, dropping blanks and
// duplicates while preserving the site's ordering.
func splitCSVFields(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	seen := make(map[string]bool)
	for _, field := range strings.Split(raw, ",") {
		v := strings.TrimSpace(field)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

// extractPornstars reads the label list and keeps only the items flagged as
// pornstar profiles; the uploader and "view more" entries are skipped.
func extractPornstars(html string) []string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}

	var out []string
	seen := make(map[string]bool)

	doc.Find(".video-tags-list li").Each(func(_ int, s *goquery.Selection) {
		inner, _ := s.Html()
		if !strings.Contains(inner, "is-pornstar") {
			return
		}
		m := PornstarNamePattern.FindStringSubmatch(inner)
		if len(m) < 2 {
			return
		}
		name := strings.TrimSpace(collapseSpaces(stripTags(m[1])))
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		out = append(out, name)
	})

	return out
}

func stripTags(s string) string {
	return tagPattern.ReplaceAllString(s, "")
}

func collapseSpaces(s string) string {
	return spacePattern.ReplaceAllString(strings.TrimSpace(s), " ")
}

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

func extractVideoFromElement(s *goquery.Selection, baseURL string) VideoMetadata {
	var video VideoMetadata

	// Find the video link: /video.{encodedId}/{slug}
	linkElem := s.Find("a[href*='/video.']")
	if linkElem.Length() == 0 {
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

	// The title attribute on the card link is the clean source: the link's
	// text also holds the duration badge.
	if title, exists := linkElem.Attr("title"); exists && title != "" {
		video.Title = htmlUnescape(title)
	}
	if video.Title == "" {
		if titleElem := s.Find(".title, .video-title, h3, .thumb-under .title a").First(); titleElem.Length() > 0 {
			if inner, err := titleElem.Html(); err == nil {
				video.Title = htmlUnescape(headingText(inner))
			}
		}
	}
	if video.Title == "" {
		if alt, exists := imgElem.Attr("alt"); exists {
			video.Title = htmlUnescape(alt)
		}
	}

	// Cards render the duration as "7 min" or "1 h 12 min"; the older
	// template used a clock value, so both forms are accepted.
	if durationElem := s.Find(".duration, .video-duration, [class*='duration']").First(); durationElem.Length() > 0 {
		if text := strings.TrimSpace(durationElem.Text()); text != "" {
			video.Duration = text
			video.DurationSec = parseCardDuration(text)
		}
	}

	if viewsElem := s.Find(".views, .view-count, [class*='views']").First(); viewsElem.Length() > 0 {
		viewsText := htmlUnescape(collapseSpaces(viewsElem.Text()))
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

	// The uploader is the channel link in the card metadata block; the
	// markup carries no dedicated class for it.
	if authorElem := s.Find(".uploader, .author, [class*='channel'] a, [class*='uploader'] a, .metadata .name, .thumb-under .name").First(); authorElem.Length() > 0 {
		video.Uploader = htmlUnescape(collapseSpaces(authorElem.Text()))
	}

	// The numeric id and the CDN id are published as data attributes. The
	// CDN id sits on the thumbnail rather than on the card element.
	video.VideoID = firstAttr(s, "data-videoid", "data-id")
	video.CDNID = firstAttr(s, "data-idcdn")

	return video
}

// firstAttr returns the value of the first attribute that is present and
// non-empty, searching the element and then its thumbnail.
func firstAttr(s *goquery.Selection, names ...string) string {
	for _, name := range names {
		if v, ok := s.Attr(name); ok && v != "" {
			return v
		}
		if img := s.Find("img").First(); img.Length() > 0 {
			if v, ok := img.Attr(name); ok && v != "" {
				return v
			}
		}
	}
	return ""
}

// parseCardDuration converts a card duration label into seconds. It accepts
// the "1 h 12 min" / "7 min" form used on current cards and the older
// "MM:SS" / "HH:MM:SS" clock form.
func parseCardDuration(text string) int {
	if m := CardDurationClockPattern.FindStringSubmatch(text); len(m) >= 2 {
		total := 0
		for _, part := range strings.Split(m[1], ":") {
			total = total*60 + atoiSafe(part)
		}
		return total
	}

	seconds := 0
	if m := CardDurationHoursPattern.FindStringSubmatch(text); len(m) >= 2 {
		seconds += atoiSafe(m[1]) * 3600
	}
	if m := CardDurationMinsPattern.FindStringSubmatch(text); len(m) >= 2 {
		seconds += atoiSafe(m[1]) * 60
	}
	return seconds
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

	// The active page marker holds a localized sort label ("Newest") on
	// the first page rather than a number, so a non-numeric marker leaves
	// the page at 1 instead of reporting page 0.
	activePage := pagination.Find(".active, .current")
	if activePage.Length() > 0 {
		if n := atoiSafe(strings.TrimSpace(activePage.First().Text())); n > 0 {
			info.CurrentPage = n
		}
	}

	maxPage := info.CurrentPage
	pagination.Find("a").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
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
	// XVIDEOS uses URL patterns like /?k=keyword&p=2 or /best/2
	re := regexp.MustCompile(`/(\d+)(?:/?)$`)
	if re.MatchString(currentURL) {
		return re.ReplaceAllString(currentURL, fmt.Sprintf("/%d", nextPage))
	}
	if strings.Contains(currentURL, "p=") {
		re := regexp.MustCompile(`p=\d+`)
		return re.ReplaceAllString(currentURL, fmt.Sprintf("p=%d", nextPage))
	}
	if strings.HasSuffix(currentURL, "/") {
		return currentURL + fmt.Sprintf("%d", nextPage)
	}
	if strings.Contains(currentURL, "?") {
		return currentURL + "&p=" + fmt.Sprintf("%d", nextPage)
	}
	return currentURL + "/" + fmt.Sprintf("%d", nextPage)
}

// htmlUnescape decodes the HTML entities the site emits in titles and
// labels, then normalizes the result through the shared text cleaner.
func htmlUnescape(s string) string {
	replacements := []struct{ from, to string }{
		{"&amp;", "&"},
		{"&lt;", "<"},
		{"&gt;", ">"},
		{"&quot;", "\""},
		{"&#39;", "'"},
		{"&#039;", "'"},
		{"&apos;", "'"},
	}
	for _, r := range replacements {
		s = strings.ReplaceAll(s, r.from, r.to)
	}
	return xutil.CleanText(s)
}
