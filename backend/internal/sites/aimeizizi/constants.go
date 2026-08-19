package aimeizizi

import (
	"regexp"
	"strings"
)

// GalleryPageMetadata holds parsed data from a single gallery page.
type GalleryPageMetadata struct {
	H1Title      string
	RawTitle     string
	Tags         []string
	Category     string
	CoverURL     string
	PublishTime  string
	CurrentPage  int
	TotalPages   int
	Images       []GalleryImageEntry
	Videos       []string
}

// GalleryImageEntry represents a single image URL with its page index.
type GalleryImageEntry struct {
	URL       string
	PageIndex int
}

// ArticlePageConfig mirrors the JSON embedded in the article-page-config
// script tag, carrying pagination and video metadata.
type ArticlePageConfig struct {
	PageID     int `json:"pageId"`
	Pagination struct {
		CurrentPage int  `json:"current_page"`
		TotalPages  int  `json:"total_pages"`
		HasNext     bool `json:"has_next"`
		HasPrev     bool `json:"has_prev"`
	} `json:"pagination"`
	Title struct {
		BaseTitle string `json:"baseTitle"`
	} `json:"title"`
	Video struct {
		Enabled bool `json:"enabled"`
		Count   int  `json:"count"`
	} `json:"video"`
}

var articleIDPattern = regexp.MustCompile(`/article/(\d+)`)

// ExtractArticleID extracts the numeric article ID from a URL.
func ExtractArticleID(url string) string {
	m := articleIDPattern.FindStringSubmatch(url)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractDomainFromUrl extracts the scheme+host portion of a URL,
// matching against the provided domain list.
func ExtractDomainFromUrl(rawURL string, domains []string) string {
	for _, domain := range domains {
		if strings.HasPrefix(rawURL, domain) {
			return domain
		}
	}
	return ""
}

// removePublisherPrefix strips known publisher prefixes from a title.
func removePublisherPrefix(title string, prefixes []string) string {
	for _, prefix := range prefixes {
		if strings.HasPrefix(title, prefix) {
			return strings.TrimSpace(title[len(prefix):])
		}
	}
	return title
}

// cleanTitleImpl removes publisher prefixes and site suffix patterns
// from a raw title string, using the provided compiled patterns.
func cleanTitleImpl(rawTitle string, suffixPatterns []*regexp.Regexp, prefixes []string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	title = regexp.MustCompile(`^\[.*?\]\s*`).ReplaceAllString(title, "")
	title = removePublisherPrefix(title, prefixes)
	for _, pattern := range suffixPatterns {
		title = pattern.ReplaceAllString(title, "")
	}
	title = regexp.MustCompile(`(?i)\s*[-\s]*$`).ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}
