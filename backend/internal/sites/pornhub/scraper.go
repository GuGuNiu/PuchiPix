package pornhub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/xutil"
)

var scraperLogger = infra.NewLogger("PornhubScraper")

// flashvars is the subset of the player configuration object that carries
// stream URLs and the scalar metadata. Live pages assign it to
// flashvars_N with escaped forward slashes inside every URL.
//
// Fields the parser does not need are deliberately absent: the object also
// carries tracker payloads whose value types change between page templates,
// and a typed field that does not match would abort the whole decode.
type flashvars struct {
	MediaDefinitions []mediaDefinition `json:"mediaDefinitions"`
	VideoTitle       string            `json:"video_title"`
	VideoDuration    int               `json:"video_duration"`
	ImageURL         string            `json:"image_url"`
	UploaderLink     string            `json:"uploaderLink"`
	Views            string            `json:"views"`
	IsVR             int               `json:"isVR"`
}

type mediaDefinition struct {
	Height    int    `json:"height"`
	Format    string `json:"format"`
	VideoURL  string `json:"videoUrl"`
	Quality   any    `json:"quality"`
	IsDefault bool   `json:"defaultQuality"`
}

// modelProfile is the MODEL_PROFILE object that names the uploader of a
// model-curated video.
type modelProfile struct {
	Username         string `json:"username"`
	ModelProfileLink string `json:"modelProfileLink"`
}

// jsonLDVideoObject represents the relevant fields of a Schema.org
// VideoObject JSON-LD block embedded in PORNHUB video pages.
//
// InteractionStatistic is declared as a raw message: current pages emit an
// array of counters, so a typed field would fail the whole unmarshal and
// cost the title, duration and upload date along with it.
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

// ScrapeDetailHTTP extracts the HLS M3U8 URLs and MP4 direct links from the
// inline flashvars object of a server-rendered detail page, then fills
// metadata from JSON-LD with OG and Twitter meta tags as fallback.
func ScrapeDetailHTTP(ctx context.Context, pageURL string) (*VideoDetailResult, error) {
	scraperLogger.Info("Scraping detail page",
		infra.LogContext{Extra: map[string]any{
			"url": pageURL,
		}})

	html, err := fetchPageHTML(ctx, pageURL)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch failed: %w", err)
	}

	if IsAntiBotPage(html) {
		return nil, fmt.Errorf("anti-bot interstitial served instead of the video page: %s", pageURL)
	}

	viewKey := ExtractViewKey(pageURL)

	result := &VideoDetailResult{
		VideoMetadata: VideoMetadata{
			ID:      viewKey,
			ViewKey: viewKey,
			PageURL: pageURL,
		},
	}

	extractMediaURLs(html, result)

	result.Title = extractTitle(html)
	result.ThumbnailURL = extractThumbnail(html)
	extractMetadataFromJSONLD(html, result)
	extractModelProfile(html, result)

	result.Uploader = extractUploader(html, result)
	result.Tags = extractTags(html)
	result.Categories = extractCategories(html)
	result.Cast = extractCast(html)
	result.PublishDate = resolvePublishDate(result)
	result.IsVR = extractIsVR(html)

	if result.M3U8URL == "" && result.MP4URL == "" && result.GetMediaURL == "" {
		return nil, fmt.Errorf("no video source found on page (removed video, premium lock or region block): %s", pageURL)
	}

	scraperLogger.Info("Detail page scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":         pageURL,
			"viewKey":     viewKey,
			"m3u8Found":   result.M3U8URL != "",
			"m3u8Count":   len(result.M3U8Candidates),
			"mp4Found":    result.MP4URL != "",
			"getMediaUrl": result.GetMediaURL != "",
			"title":       result.Title,
			"uploader":    result.Uploader,
			"views":       result.Views,
			"tagsCount":   len(result.Tags),
			"catsCount":   len(result.Categories),
			"castCount":   len(result.Cast),
		}})

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
// Actors are only populated from real values: an empty uploader must not
// become a one-element slice holding "", which downstream normalization
// would treat as an actor named nothing.
func (r *VideoDetailResult) ToScrapeResult(pageURL string) *sites.ScrapeResult {
	out := &sites.ScrapeResult{
		M3U8URL: r.M3U8URL,
		Title:   r.Title,
		PageURL: pageURL,
		Tags:    r.Tags,
	}

	for _, c := range r.M3U8Candidates {
		if c.URL == "" || c.URL == r.M3U8URL {
			continue
		}
		out.M3U8Candidates = append(out.M3U8Candidates, sites.M3U8Candidate{URL: c.URL, Title: c.Title})
	}

	// The site labels performers under data-label="pornstar"; the uploader
	// is a channel and must not be mixed in as an actor.
	cast := r.Cast
	if len(cast) == 0 && r.Uploader != "" {
		cast = []string{r.Uploader}
	}
	if len(cast) > 0 {
		out.Actors = cast
	}

	if len(r.Categories) > 0 {
		out.Categories = r.Categories
	}

	return out
}

// CastText renders the performer list for the gallery-shaped result, where
// no dedicated field exists for it.
func (r *VideoDetailResult) CastText() string {
	return strings.Join(r.Cast, ", ")
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
	// and yield /video/view_video.php?viewkey=... on a /video listing.
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
//
// The age-gate cookies are mandatory and the full browser header set is
// required: PORNHUB serves the disclaimer interstitial to clients that look
// like a plain HTTP client, in which case the flashvars object is absent and
// no stream URL exists on the page.
func fetchPageHTML(ctx context.Context, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	profile := stealth.RandomProfile()
	for k, v := range stealth.DocumentRequestHeaders(&profile, extractBaseURL(pageURL)+"/") {
		req.Header.Set(k, v)
	}
	req.Header.Set("Cookie", AgeGateCookies)

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

// parseFlashvars decodes the player configuration object. Escaped forward
// slashes are normalized because every URL inside the object is emitted with
// them.
//
// A type mismatch on one field is tolerated: encoding/json still decodes
// every other field before reporting the error, and discarding the whole
// object over an unused tracker field would lose the stream URLs.
func parseFlashvars(html string) *flashvars {
	m := FlashvarsPattern.FindStringSubmatch(html)
	if len(m) < 2 {
		return nil
	}
	raw := strings.ReplaceAll(m[1], `\/`, "/")
	var fv flashvars
	if err := json.Unmarshal([]byte(raw), &fv); err != nil && !isRecoverableJSONError(err) {
		return nil
	}
	return &fv
}

// isRecoverableJSONError reports whether decoding can be trusted to have
// populated the fields that did match.
func isRecoverableJSONError(err error) bool {
	var typeErr *json.UnmarshalTypeError
	return errors.As(err, &typeErr)
}

// parseJSONLD returns the first Schema.org VideoObject block on the page.
// A block whose @type is absent is still accepted because the detail page
// emits exactly one ld+json script and it is always the video.
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
		if err := json.Unmarshal([]byte(raw), &obj); err != nil && !isRecoverableJSONError(err) {
			continue
		}
		if obj.Type == "" || obj.Type == "VideoObject" {
			return &obj
		}
	}
	return nil
}

// extractMediaURLs reads every rendition the flashvars object advertises and
// promotes the site's default HLS quality to the primary stream.
func extractMediaURLs(html string, result *VideoDetailResult) {
	fv := parseFlashvars(html)
	if fv == nil {
		return
	}

	type candidate struct {
		url      string
		title    string
		height   int
		fallback bool
	}

	var hls []candidate
	links := make(map[string]string)

	for _, def := range fv.MediaDefinitions {
		url := strings.TrimSpace(def.VideoURL)
		if url == "" {
			continue
		}
		height := def.Height
		if height == 0 {
			height = atoiSafe(fmt.Sprintf("%v", def.Quality))
		}

		switch strings.ToLower(def.Format) {
		case "hls":
			hls = append(hls, candidate{url: url, title: qualityLabel(height), height: height, fallback: def.IsDefault})
		case "mp4":
			// The MP4 rendition is not a direct file but a get_media
			// endpoint that answers with a JSON list of direct links.
			if strings.Contains(url, "video/get_media") {
				result.GetMediaURL = url
			} else {
				links[qualityLabel(height)] = url
			}
		}
	}

	// Legacy pages key MP4 renditions as quality_NNNp instead.
	for _, m := range MP4QualityPattern.FindAllStringSubmatch(html, -1) {
		if len(m) >= 3 {
			links[strings.TrimSuffix(m[1], "p")] = strings.ReplaceAll(m[2], `\/`, "/")
		}
	}

	if len(hls) > 0 {
		sort.SliceStable(hls, func(i, j int) bool {
			if hls[i].fallback != hls[j].fallback {
				return hls[i].fallback
			}
			return hls[i].height > hls[j].height
		})
		for _, c := range hls {
			result.M3U8Candidates = append(result.M3U8Candidates, M3U8Candidate{
				URL: c.url, Title: c.title, Height: c.height,
			})
		}
		result.M3U8URL = hls[0].url
	}

	if len(links) > 0 {
		result.MP4Links = links
		result.MP4URL = pickBestQuality(links)
	}
}

// ResolveGetMedia downloads the get_media endpoint and returns the direct
// MP4 links it advertises. Videos that are HLS-only answer with an empty
// list, in which case ok is false and the caller keeps the HLS stream.
func ResolveGetMedia(ctx context.Context, getMediaURL, referer string) (links map[string]string, ok bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, getMediaURL, nil)
	if err != nil {
		return nil, false, fmt.Errorf("failed to create request: %w", err)
	}
	profile := stealth.RandomProfile()
	for k, v := range stealth.CDNRequestHeaders(&profile, referer, stealth.FetchDestEmpty) {
		req.Header.Set(k, v)
	}
	req.Header.Set("Cookie", AgeGateCookies)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("get_media request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("get_media HTTP error: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, fmt.Errorf("get_media read failed: %w", err)
	}

	var entries []struct {
		VideoURL string `json:"videoUrl"`
		Quality  any    `json:"quality"`
	}
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, false, fmt.Errorf("get_media JSON parse failed: %w", err)
	}

	out := make(map[string]string, len(entries))
	for _, e := range entries {
		if e.VideoURL == "" {
			continue
		}
		out[qualityLabel(atoiSafe(fmt.Sprintf("%v", e.Quality)))] = e.VideoURL
	}
	if len(out) == 0 {
		return nil, false, nil
	}
	return out, true, nil
}

func qualityLabel(height int) string {
	if height <= 0 {
		return "auto"
	}
	return strconv.Itoa(height) + "p"
}

// pickBestQuality selects the highest-resolution URL from a quality map.
func pickBestQuality(links map[string]string) string {
	best := ""
	bestNum := -1
	for quality, url := range links {
		n, err := strconv.Atoi(strings.TrimSuffix(quality, "p"))
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

func extractTitle(html string) string {
	if obj := parseJSONLD(html); obj != nil && obj.Name != "" {
		return htmlUnescape(obj.Name)
	}

	if m := TwitterTitlePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	if fv := parseFlashvars(html); fv != nil && fv.VideoTitle != "" {
		return htmlUnescape(fv.VideoTitle)
	}

	if m := JSONLDNamePattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}

	return ""
}

func extractThumbnail(html string) string {
	if obj := parseJSONLD(html); obj != nil && len(obj.ThumbnailURL) > 0 && obj.ThumbnailURL[0] != "" {
		return obj.ThumbnailURL[0]
	}
	if m := ThumbnailPattern.FindStringSubmatch(html); len(m) >= 2 && m[1] != "" {
		return htmlUnescape(m[1])
	}
	if fv := parseFlashvars(html); fv != nil && fv.ImageURL != "" {
		return fv.ImageURL
	}
	return ""
}

// extractUploader resolves the uploader through two sources, most specific
// first: the model display name from MODEL_PROFILE, then the anchor text
// embedded in the uploaderLink HTML fragment, then the JSON-LD author.
func extractUploader(html string, result *VideoDetailResult) string {
	if result.Uploader != "" {
		return result.Uploader
	}
	if fv := parseFlashvars(html); fv != nil {
		if m := AnchorTextPattern.FindStringSubmatch(fv.UploaderLink); len(m) >= 2 && m[1] != "" {
			return htmlUnescape(m[1])
		}
	}
	if obj := parseJSONLD(html); obj != nil {
		if name := jsonLDAuthorName(obj.Author); name != "" {
			return name
		}
	}
	return ""
}

// jsonLDAuthorName normalizes the JSON-LD author field, which is a bare
// string on current pages but was an array of name objects before.
func jsonLDAuthorName(author any) string {
	switch v := author.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		for _, entry := range v {
			if obj, ok := entry.(map[string]any); ok {
				if name, ok := obj["name"].(string); ok && name != "" {
					return strings.TrimSpace(name)
				}
			}
		}
	case map[string]any:
		if name, ok := v["name"].(string); ok && name != "" {
			return strings.TrimSpace(name)
		}
	}
	return ""
}

// extractIsVR reports whether the player configuration flags a VR video.
func extractIsVR(html string) bool {
	fv := parseFlashvars(html)
	return fv != nil && fv.IsVR == 1
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

	if fv := parseFlashvars(html); fv != nil {
		if result.DurationSec == 0 && fv.VideoDuration > 0 {
			result.DurationSec = fv.VideoDuration
			result.Duration = fmtDuration(fv.VideoDuration/3600, (fv.VideoDuration%3600)/60, fv.VideoDuration%60)
		}
		if result.Views == 0 {
			result.Views = ExtractViews(fv.Views)
			result.ViewsText = fv.Views
		}
		if result.Title == "" && fv.VideoTitle != "" {
			result.Title = fv.VideoTitle
		}
		if result.ThumbnailURL == "" && fv.ImageURL != "" {
			result.ThumbnailURL = fv.ImageURL
		}
	}
}

func extractModelProfile(html string, result *VideoDetailResult) {
	m := ModelProfilePattern.FindStringSubmatch(html)
	if len(m) < 2 {
		return
	}
	var mp modelProfile
	if err := json.Unmarshal([]byte(strings.ReplaceAll(m[1], `\/`, "/")), &mp); err != nil {
		return
	}
	if mp.Username != "" {
		result.Uploader = htmlUnescape(mp.Username)
	}
	if mp.ModelProfileLink != "" {
		result.UploaderURL = mp.ModelProfileLink
	}
}

// resolvePublishDate falls back to the YYYYMM/DD segment of the media path
// when JSON-LD carries no uploadDate.
func resolvePublishDate(result *VideoDetailResult) string {
	if result.PublishDate != "" {
		return result.PublishDate
	}
	if result.M3U8URL != "" {
		if m := MediaPathDatePattern.FindStringSubmatch(result.M3U8URL); len(m) >= 4 {
			return fmt.Sprintf("%s-%s-%s", m[1], m[2], m[3])
		}
	}
	return result.PublishDate
}

// extractTags reads the site's semantic tag markers. The data-label
// attribute is stable across page redesigns, unlike the surrounding class
// names, so it is the primary source.
func extractTags(html string) []string {
	return extractLabeledLinks(html, "tag")
}

// extractCategories reads the site's semantic category markers, which are
// the under-player category chips.
func extractCategories(html string) []string {
	return extractLabeledLinks(html, "category")
}

// extractCast reads the pornstar markers, which name the performers.
func extractCast(html string) []string {
	return extractLabeledLinks(html, "pornstar")
}

func extractLabeledLinks(html string, label string) []string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil
	}

	selector := fmt.Sprintf("[data-label=%q]", label)
	var out []string
	seen := make(map[string]bool)

	doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		if text == "" || len(text) >= 60 || seen[text] {
			return
		}
		seen[text] = true
		out = append(out, text)
	})

	return out
}

func extractVideosFromDocument(doc *goquery.Document, baseURL string) []VideoMetadata {
	var videos []VideoMetadata
	seen := make(map[string]bool)

	// Verified on current listing pages: every card is a li.videoBox and
	// carries the view key in data-video-vkey.
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

func extractVideoFromElement(s *goquery.Selection, baseURL string) VideoMetadata {
	var video VideoMetadata

	if vkey, exists := s.Attr("data-video-vkey"); exists && vkey != "" {
		video.ViewKey = vkey
	} else if vkey, exists := s.Find("[data-video-vkey]").First().Attr("data-video-vkey"); exists && vkey != "" {
		video.ViewKey = vkey
	}

	linkElem := s.Find("a[href*='viewkey=']").First()
	if linkElem.Length() == 0 {
		linkElem = s.Find("a[href*='/watch/']").First()
	}
	if linkElem.Length() == 0 {
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

	// Duration badge: <var class="duration">11:30</var>.
	durationElem := s.Find("var.duration, .duration, .marker-overlap var").First()
	if durationElem.Length() > 0 {
		durationText := strings.TrimSpace(durationElem.Text())
		if durationText != "" {
			video.Duration = durationText
			video.DurationSec = parseClockDuration(durationText)
		}
	}

	viewsElem := s.Find(".views var").First()
	if viewsElem.Length() > 0 {
		viewsText := strings.TrimSpace(viewsElem.Text())
		video.ViewsText = viewsText
		video.Views = ExtractViews(viewsText)
	}

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
		total = total*60 + atoiSafe(strings.TrimSpace(p))
	}
	return total
}

// nextGlyph is the double-angle bracket renderers use for the pager's next
// link; the link text is localized, so the glyph is the stable signal.
const nextGlyph = "\u00bb"

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

	pagination := doc.Find(".pagination, .pager, [class*='pagination'], [class*='pageNextPrevWrapper']")
	if pagination.Length() == 0 {
		return info
	}

	activePage := pagination.Find(".active, .current, li[class*='active']")
	if activePage.Length() > 0 {
		info.CurrentPage = atoiSafe(strings.TrimSpace(activePage.First().Text()))
	}

	maxPage := info.CurrentPage
	pagination.Find("a").Each(func(_ int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		href, exists := s.Attr("href")
		lower := strings.ToLower(text)
		if strings.Contains(lower, "next") || strings.Contains(text, nextGlyph) {
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

// buildNextPageURL inserts or rewrites the ?page=N segment, which is the
// pagination form used on search and category pages.
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
