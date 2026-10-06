package aimeizizi

import (
	"regexp"
	"strings"
)

type GalleryPageMetadata struct {
	H1Title     string
	RawTitle    string
	Tags        []string
	Category    string
	CoverURL    string
	PublishTime string
	CurrentPage int
	TotalPages  int
	Images      []GalleryImageEntry
	Videos      []string
}

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

func ExtractArticleID(url string) string {
	m := articleIDPattern.FindStringSubmatch(url)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func ExtractDomainFromUrl(rawURL string, domains []string) string {
	for _, domain := range domains {
		if strings.HasPrefix(rawURL, domain) {
			return domain
		}
	}
	return ""
}

func removePublisherPrefix(title string, prefixes []string) string {
	for _, prefix := range prefixes {
		if strings.HasPrefix(title, prefix) {
			return strings.TrimSpace(title[len(prefix):])
		}
	}
	return title
}

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
