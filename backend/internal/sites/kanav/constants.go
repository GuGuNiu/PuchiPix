package kanav

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// VideoMetadata represents a single video item extracted from listing or detail page.
type VideoMetadata struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	PageURL      string `json:"pageUrl"`
	ThumbnailURL string `json:"thumbnailUrl"`
	Views        int    `json:"views"`
	ViewsText    string `json:"viewsText"`
	Duration     string `json:"duration"`
	PublishDate  string `json:"publishDate"`
	Category     string `json:"category"`
	CategoryID   int    `json:"categoryId"`
}

// ListingPageResult holds the parsed data from a video listing page.
type ListingPageResult struct {
	Videos      []VideoMetadata `json:"videos"`
	TotalPages  int             `json:"totalPages"`
	CurrentPage int             `json:"currentPage"`
	HasNextPage bool            `json:"hasNextPage"`
	NextPageURL string          `json:"nextPageUrl,omitempty"`
}

// CategoryConfig defines the configuration for a video category.
type CategoryConfig struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// SortType represents the available sorting options.
type SortType string

const (
	SortTypeTime      SortType = "time"       // 最新发布
	SortTypeHits      SortType = "hits"       // 最多观看
	SortTypeHitsWeek  SortType = "hits_week"  // 本周热榜
)

// URL patterns for KanAV site
const (
	BasePath           = "/index.php/vod"
	ListingPathFormat  = BasePath + "/show/by/%s/id/%d.html"
	ListingPathPaged   = BasePath + "/show/by/%s/id/%d/page/%d.html"
	DetailPathFormat   = BasePath + "/play/id/%d/sid/1/nid/1.html"
)

// CSS selectors for page extraction
const (
	// Listing page selectors
	VideoItemSelector     = ".col-md-3.col-sm-6.col-xs-6"
	VideoLinkSelector     = ".video-item a"
	VideoImageSelector    = ".video-item img"
	VideoViewsSelector    = ".video-item .model-view-left"
	VideoDurationSelector = ".video-item .model-view"
	EntryTitleSelector    = ".entry-title"

	// Pagination selectors
	PaginationSelector = ".pagination"
	ActivePageSelector = ".pagination .active"
)

// Pre-compiled regex patterns
var (
	// Video ID extraction from URL: /vod/play/id/12345/...
	VideoIDPattern = regexp.MustCompile(`/id/(\d+)`)

	// Views extraction: "1234 Views" or "1,234 Views"
	ViewsPattern = regexp.MustCompile(`([\d,]+)\s*Views`)

	// Date extraction: "2026 / 08 / 03"
	DatePattern = regexp.MustCompile(`(\d{4})\s*/\s*(\d{1,2})\s*/\s*(\d{1,2})`)

	// Page number extraction from URL
	PageNumberPattern = regexp.MustCompile(`/page/(\d+)\.html`)
)

// CategoryConfigs defines all available video categories.
var CategoryConfigs = []CategoryConfig{
	{ID: 1, Name: "中文字幕", Slug: "chinese-sub"},
	{ID: 2, Name: "日韩有码", Slug: "jav-censored"},
	{ID: 3, Name: "日韩无码", Slug: "jav-uncensored"},
	{ID: 4, Name: "国产AV", Slug: "chinese-av"},
	{ID: 20, Name: "动漫番剧", Slug: "anime"},
	{ID: 22, Name: "流出自拍", Slug: "leaked"},
	{ID: 25, Name: "里番", Slug: "hentai"},
	{ID: 26, Name: "泡面番", Slug: "short-anime"},
	{ID: 30, Name: "自拍泄密", Slug: "self-leaked"},
	{ID: 31, Name: "探花约炮", Slug: "escort"},
	{ID: 32, Name: "主播录制", Slug: "streamer"},
}

// GetCategoryByID returns the category config by ID.
func GetCategoryByID(id int) (CategoryConfig, bool) {
	for _, cat := range CategoryConfigs {
		if cat.ID == id {
			return cat, true
		}
	}
	return CategoryConfig{}, false
}

// ExtractVideoID extracts the numeric video ID from a URL.
func ExtractVideoID(url string) string {
	m := VideoIDPattern.FindStringSubmatch(url)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractViews parses the views count from text like "1,234 Views".
func ExtractViews(text string) int {
	m := ViewsPattern.FindStringSubmatch(text)
	if len(m) >= 2 {
		viewsStr := strings.ReplaceAll(m[1], ",", "")
		views, err := strconv.Atoi(viewsStr)
		if err == nil {
			return views
		}
	}
	return 0
}

// ExtractDate parses the date from text like "2026 / 08 / 03".
func ExtractDate(text string) string {
	m := DatePattern.FindStringSubmatch(text)
	if len(m) >= 4 {
		return m[1] + "-" + padZero(m[2]) + "-" + padZero(m[3])
	}
	return ""
}

// padZero ensures a number string has leading zero if single digit.
func padZero(s string) string {
	if len(s) == 1 {
		return "0" + s
	}
	return s
}

// ExtractPageNumber extracts page number from URL like /page/2.html.
func ExtractPageNumber(url string) int {
	m := PageNumberPattern.FindStringSubmatch(url)
	if len(m) >= 2 {
		page := 0
		for _, c := range m[1] {
			if c >= '0' && c <= '9' {
				page = page*10 + int(c-'0')
			}
		}
		return page
	}
	return 1
}

// BuildListingURL constructs a listing page URL.
func BuildListingURL(baseURL string, categoryID int, sort SortType, page int) string {
	if page <= 1 {
		return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d.html", baseURL, sort, categoryID)
	}
	return fmt.Sprintf("%s/index.php/vod/show/by/%s/id/%d/page/%d.html", baseURL, sort, categoryID, page)
}

// BuildDetailURL constructs a detail page URL.
func BuildDetailURL(baseURL string, videoID string) string {
	return baseURL + "/index.php/vod/play/id/" + videoID + "/sid/1/nid/1.html"
}
