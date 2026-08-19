package kanav

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// PageExtractor provides methods for extracting data from KanAV HTML pages.
type PageExtractor struct {
	BaseURL string
}

// NewPageExtractor creates a new page extractor with the given base URL.
func NewPageExtractor(baseURL string) *PageExtractor {
	return &PageExtractor{BaseURL: baseURL}
}

// ExtractVideoList extracts a list of videos from a listing page document.
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
func (e *PageExtractor) ExtractVideoItem(s *goquery.Selection) VideoMetadata {
	var video VideoMetadata

	// The structure is:
	// <div class="col-md-3 col-sm-6 col-xs-6">
	//   <div class="video-item">
	//     <div class="featured-content-image">
	//       <a href="/index.php/vod/play/id/XXX/...">
	//         <img data-original="..." alt="Title" src="...">
	//         <span class="model-view-left">1234 Views</span>
	//         <span class="model-view">1小时 2分钟</span>
	//       </a>
	//     </div>
	//   </div>
	//   <div class="entry-title">
	//     <a href="...">Title</a> 2026 / 08 / 03
	//   </div>
	// </div>

	videoItem := s.Find(".video-item")
	if videoItem.Length() == 0 {
		return video
	}

	// Extract from image link
	linkElem := videoItem.Find("a[href*='/vod/play/id/']")
	href, exists := linkElem.Attr("href")
	if !exists {
		return video
	}

	video.ID = ExtractVideoID(href)
	if video.ID == "" {
		return video
	}

	// Build full page URL
	video.PageURL = e.resolveURL(href)

	// Extract image data
	imgElem := linkElem.Find("img")
	video.ThumbnailURL, _ = imgElem.Attr("data-original")
	if video.ThumbnailURL == "" {
		video.ThumbnailURL, _ = imgElem.Attr("src")
	}
	video.Title, _ = imgElem.Attr("alt")

	// Extract views and duration from overlay spans
	viewsElem := linkElem.Find(".model-view-left")
	viewsText := strings.TrimSpace(viewsElem.Text())
	video.ViewsText = viewsText
	video.Views = parseViews(viewsText)

	durationElem := linkElem.Find(".model-view")
	video.Duration = strings.TrimSpace(durationElem.Text())

	// Extract date from entry-title
	entryTitle := s.Find(".entry-title")
	if entryTitle.Length() > 0 {
		entryText := entryTitle.Text()
		video.PublishDate = ExtractDate(entryText)

		// Try to extract category if not in views
		if video.Category == "" && !strings.Contains(viewsText, "Views") {
			video.Category = viewsText
		}
	}

	return video
}

// ExtractPagination extracts pagination information from the document.
func (e *PageExtractor) ExtractPagination(doc *goquery.Document, currentURL string) PaginationInfo {
	info := PaginationInfo{
		CurrentPage: 1,
		HasNextPage: false,
	}

	// Find active/current page
	doc.Find(".pagination .active, .pagination .current").Each(func(i int, s *goquery.Selection) {
		pageText := strings.TrimSpace(s.Text())
		if pageNum, err := strconv.Atoi(pageText); err == nil {
			info.CurrentPage = pageNum
		}
	})

	// Find all page links to determine total pages
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

	// Check for next page link
	doc.Find(".pagination a").Each(func(i int, s *goquery.Selection) {
		text := strings.TrimSpace(s.Text())
		href, exists := s.Attr("href")
		if !exists {
			return
		}

		// Look for next page indicators
		isNextLink := strings.Contains(text, "下一页") ||
			strings.Contains(text, "»") ||
			strings.Contains(text, "Next")

		if isNextLink && !s.HasClass("disabled") {
			info.HasNextPage = true
			info.NextPageURL = e.resolveURL(href)
		}
	})

	// If no explicit next link but current page < max page
	if !info.HasNextPage && info.CurrentPage < maxPage {
		info.HasNextPage = true
		info.NextPageURL = e.buildPageURL(currentURL, info.CurrentPage+1)
	}

	return info
}

// ExtractDetailMetadata extracts metadata from a video detail page.
func (e *PageExtractor) ExtractDetailMetadata(doc *goquery.Document) map[string]string {
	metadata := make(map[string]string)

	// Extract title
	titleElem := doc.Find("h1.title, .video-title, .entry-title h1")
	if titleElem.Length() > 0 {
		metadata["title"] = strings.TrimSpace(titleElem.Text())
	}

	// Extract description
	descElem := doc.Find(".video-description, .description, .content-detail")
	if descElem.Length() > 0 {
		metadata["description"] = strings.TrimSpace(descElem.Text())
	}

	// Extract tags
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

	// Extract category
	catElem := doc.Find(".video-category, .category")
	if catElem.Length() > 0 {
		metadata["category"] = strings.TrimSpace(catElem.Text())
	}

	// Extract publish date
	dateElem := doc.Find(".video-date, .publish-date, .date")
	if dateElem.Length() > 0 {
		metadata["publish_date"] = strings.TrimSpace(dateElem.Text())
	}

	// Extract views
	viewsElem := doc.Find(".video-views, .views")
	if viewsElem.Length() > 0 {
		metadata["views"] = strings.TrimSpace(viewsElem.Text())
	}

	return metadata
}

// ExtractRelatedVideos extracts related video links from a detail page.
func (e *PageExtractor) ExtractRelatedVideos(doc *goquery.Document) []VideoMetadata {
	var videos []VideoMetadata

	// Look for related videos section
	doc.Find(".related-videos .video-item, .related .video-item, .recommend .video-item").Each(func(i int, s *goquery.Selection) {
		video := e.ExtractVideoItem(s)
		if video.ID != "" {
			videos = append(videos, video)
		}
	})

	return videos
}

// resolveURL resolves a relative URL to absolute.
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

// buildPageURL constructs a page URL with the given page number.
func (e *PageExtractor) buildPageURL(currentURL string, page int) string {
	// Handle different URL patterns
	if strings.Contains(currentURL, "/page/") {
		// Replace existing page number
		re := regexp.MustCompile(`/page/\d+\.html`)
		return re.ReplaceAllString(currentURL, "/page/"+strconv.Itoa(page)+".html")
	}

	if strings.HasSuffix(currentURL, ".html") {
		// Insert page before .html
		return strings.Replace(currentURL, ".html", "/page/"+strconv.Itoa(page)+".html", 1)
	}

	return currentURL
}

// parseViews parses view count from text like "1,234 Views" or "1234 Views".
func parseViews(text string) int {
	// Remove "Views" and whitespace
	numStr := strings.ReplaceAll(text, "Views", "")
	numStr = strings.ReplaceAll(numStr, ",", "")
	numStr = strings.TrimSpace(numStr)

	if num, err := strconv.Atoi(numStr); err == nil {
		return num
	}
	return 0
}

// parseDuration parses duration string to seconds.
func parseDuration(duration string) int {
	// Handle formats like:
	// "1小时 2分钟 30秒"
	// "45分钟 20秒"
	// "2小时"
	// "30秒"

	totalSeconds := 0

	// Extract hours
	hourRe := regexp.MustCompile(`(\d+)\s*小时`)
	if matches := hourRe.FindStringSubmatch(duration); len(matches) > 1 {
		if hours, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += hours * 3600
		}
	}

	// Extract minutes
	minRe := regexp.MustCompile(`(\d+)\s*分钟`)
	if matches := minRe.FindStringSubmatch(duration); len(matches) > 1 {
		if minutes, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += minutes * 60
		}
	}

	// Extract seconds
	secRe := regexp.MustCompile(`(\d+)\s*秒`)
	if matches := secRe.FindStringSubmatch(duration); len(matches) > 1 {
		if seconds, err := strconv.Atoi(matches[1]); err == nil {
			totalSeconds += seconds
		}
	}

	return totalSeconds
}

// formatDuration formats seconds to human-readable duration.
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

// parseDate parses date string to time.Time.
func parseDate(dateStr string) (time.Time, error) {
	// Try different formats
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

// isValidVideoID checks if a string is a valid video ID (numeric).
func isValidVideoID(id string) bool {
	if id == "" {
		return false
	}
	_, err := strconv.Atoi(id)
	return err == nil
}

// sanitizeTitle removes unwanted characters from title.
// Handles KanAV's combined suffix format: " - KanAV-免费高清中文AV在线看"
func sanitizeTitle(title string) string {
	// Remove extra whitespace
	title = regexp.MustCompile(`\s+`).ReplaceAllString(title, " ")

	// Remove KanAV combined suffix first (regex handles " - KanAV-...")
	title = regexp.MustCompile(`\s*[-—丨]\s*KanAV.*$`).ReplaceAllString(title, "")

	// Remove common suffixes (individual cases)
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
