package kanav

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

type PageExtractor struct {
	BaseURL string
}

func NewPageExtractor(baseURL string) *PageExtractor {
	return &PageExtractor{BaseURL: baseURL}
}

// ExtractVideoList keeps only cards that expose a parseable video ID, so
// related-video and placeholder blocks are dropped.
func (e *PageExtractor) ExtractVideoList(doc *goquery.Document) []VideoMetadata {
	var videos []VideoMetadata

	doc.Find(VideoItemSelector).Each(func(i int, s *goquery.Selection) {
		video := e.ExtractVideoItem(s)
		if video.ID != "" {
			videos = append(videos, video)
		}
	})

	return videos
}

// ExtractVideoItem extracts a single video item from a selection.
//
// A listing card nests the view-count and duration overlay spans inside the
// image link while the publish date lives in a sibling .entry-title block, so
// the two have to be read from different subtrees.
func (e *PageExtractor) ExtractVideoItem(s *goquery.Selection) VideoMetadata {
	var video VideoMetadata

	videoItem := s.Find(".video-item")
	if videoItem.Length() == 0 {
		return video
	}

	linkElem := videoItem.Find("a[href*='/vod/play/id/']")
	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.ID = ExtractVideoID(href)
	if video.ID == "" {
		return video
	}

	video.PageURL = e.resolveURL(href)

	// The lazy-loaded source is preferred; src holds the placeholder until then
	imgElem := linkElem.Find("img")
	video.ThumbnailURL, _ = imgElem.Attr("data-original")
	if video.ThumbnailURL == "" {
		video.ThumbnailURL, _ = imgElem.Attr("src")
	}
	video.Title, _ = imgElem.Attr("alt")

	viewsElem := linkElem.Find(".model-view-left")
	viewsText := strings.TrimSpace(viewsElem.Text())
	video.ViewsText = viewsText
	video.Views = parseViews(viewsText)

	durationElem := linkElem.Find(".model-view")
	video.Duration = strings.TrimSpace(durationElem.Text())

	entryTitle := s.Find(".entry-title")
	if entryTitle.Length() > 0 {
		entryText := entryTitle.Text()
		video.PublishDate = ExtractDate(entryText)

		// Homepage cards reuse the overlay span for the category label
		if video.Category == "" && !strings.Contains(viewsText, "Views") {
			video.Category = viewsText
		}
	}

	return video
}

func (e *PageExtractor) ExtractPagination(doc *goquery.Document, currentURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	doc.Find(".pagination .active, .pagination .current").Each(func(i int, s *goquery.Selection) {
		pageText := strings.TrimSpace(s.Text())
		if pageNum, err := strconv.Atoi(pageText); err == nil {
			info.CurrentPage = pageNum
		}
	})

	// The pager renders only a window of page links, so the total page count is
	// the largest page number present in the markup
	maxPage := info.CurrentPage
	doc.Find(".pagination a[href*='page/']").Each(func(i int, s *goquery.Selection) {
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

	doc.Find(".pagination a").Each(func(i int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		href, exists := s.Attr("href")
		if !exists {
			return
		}

		isNextLink := strings.Contains(text, "下一页") ||
			strings.Contains(text, "»") ||
			strings.Contains(text, "Next")

		if isNextLink && !s.HasClass("disabled") {
			info.HasNextPage = true
			info.NextPageURL = e.resolveURL(href)
		}
	})

	// Some themes drop the next arrow, so derive it from the page window
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		info.NextPageURL = e.buildPageURL(currentURL, info.CurrentPage+1)
	}

	return info
}

// ExtractDetailMetadata extracts metadata from a video detail page. Each
// selector list covers the markup variants emitted by the site themes in use.
func (e *PageExtractor) ExtractDetailMetadata(doc *goquery.Document) map[string]string {
	metadata := make(map[string]string)

	titleElem := doc.Find("h1.title, .video-title, .entry-title h1")
	if titleElem.Length() > 0 {
		metadata["title"] = strings.TrimSpace(titleElem.Text())
	}

	descElem := doc.Find(".video-description, .description, .content-detail")
	if descElem.Length() > 0 {
		metadata["description"] = strings.TrimSpace(descElem.Text())
	}

	var tags []string
	doc.Find(".video-tags a, .tags a, [rel='tag']").Each(func(i int, s *goquery.Selection) {
		tag := strings.TrimSpace(s.Text())
		if tag != "" {
			tags = append(tags, tag)
		}
	})
	if len(tags) > 0 {
		metadata["tags"] = strings.Join(tags, ", ")
	}

	catElem := doc.Find(".video-category, .category")
	if catElem.Length() > 0 {
		metadata["category"] = strings.TrimSpace(catElem.Text())
	}

	dateElem := doc.Find(".video-date, .publish-date, .date")
	if dateElem.Length() > 0 {
		metadata["publish_date"] = strings.TrimSpace(dateElem.Text())
	}

	viewsElem := doc.Find(".video-views, .views")
	if viewsElem.Length() > 0 {
		metadata["views"] = strings.TrimSpace(viewsElem.Text())
	}

	return metadata
}

func (e *PageExtractor) ExtractRelatedVideos(doc *goquery.Document) []VideoMetadata {
	var videos []VideoMetadata

	doc.Find(".related-videos .video-item, .related .video-item, .recommend .video-item").Each(func(i int, s *goquery.Selection) {
		video := e.ExtractVideoItem(s)
		if video.ID != "" {
			videos = append(videos, video)
		}
	})

	return videos
}

func (e *PageExtractor) resolveURL(href string) string {
	if strings.HasPrefix(href, "http") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return "https:" + href
	}
	if strings.HasPrefix(href, "/") {
		return e.BaseURL + href
	}
	return e.BaseURL + "/" + href
}

// buildPageURL rewrites the page segment of a listing URL, inserting one for
// first-page URLs that have no /page/ segment yet.
func (e *PageExtractor) buildPageURL(currentURL string, page int) string {
	if strings.Contains(currentURL, "/page/") {
		re := regexp.MustCompile(`/page/\d+\.html`)
		return re.ReplaceAllString(currentURL, "/page/"+strconv.Itoa(page)+".html")
	}

	if strings.HasSuffix(currentURL, ".html") {
		return strings.Replace(currentURL, ".html", "/page/"+strconv.Itoa(page)+".html", 1)
	}

	return currentURL
}

func parseViews(text string) int {
	numStr := strings.ReplaceAll(text, "Views", "")
	numStr = strings.ReplaceAll(numStr, ",", "")
	numStr = strings.TrimSpace(numStr)

	if num, err := strconv.Atoi(numStr); err == nil {
		return num
	}
	return 0
}

// parseDuration converts the localized duration text, where hour, minute and
// second counts are rendered as separate words, into total seconds.
func parseDuration(duration string) int {
	totalSeconds := 0

	hourRe := regexp.MustCompile(`(\d+)\s*小时`)
	if matches := hourRe.FindStringSubmatch(duration); len(matches) > 1 {
		if hours, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += hours * 3600
		}
	}

	minRe := regexp.MustCompile(`(\d+)\s*分钟`)
	if matches := minRe.FindStringSubmatch(duration); len(matches) > 1 {
		if minutes, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += minutes * 60
		}
	}

	secRe := regexp.MustCompile(`(\d+)\s*秒`)
	if matches := secRe.FindStringSubmatch(duration); len(matches) > 1 {
		if seconds, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += seconds
		}
	}

	return totalSeconds
}

// formatDuration renders seconds using the same localized unit words the site
// uses, dropping the seconds part once an hour is present.
func formatDuration(seconds int) string {
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	secs := seconds % 60

	if hours > 0 {
		return strconv.Itoa(hours) + "小时 " + strconv.Itoa(minutes) + "分钟"
	}
	if minutes > 0 {
		return strconv.Itoa(minutes) + "分钟 " + strconv.Itoa(secs) + "秒"
	}
	return strconv.Itoa(secs) + "秒"
}

func parseDate(dateStr string) (time.Time, error) {
	formats := []string{
		"2006-01-02",
		"2006/01/02",
		"2006-01-02 15:04:05",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, dateStr); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse date: %s", dateStr)
}

func isValidVideoID(id string) bool {
	if id == "" {
		return false
	}
	_, err := strconv.Atoi(id)
	return err == nil
}

// sanitizeTitle removes the site branding appended after the title, e.g.
// " - KanAV-..." combined with a localized tagline, plus the standalone
// quality badges the themes add.
func sanitizeTitle(title string) string {
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")

	title = regexp.MustCompile(`\s*[-—丨]\s*KanAV.*$`).ReplaceAllString(title, "")

	suffixes := []string{
		"[中文字幕]",
		"[高清]",
		" - 在线观看",
	}

	for _, suffix := range suffixes {
		title = strings.TrimSuffix(title, suffix)
	}

	return strings.TrimSpace(title)
}
