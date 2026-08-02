package aimeizizi

import (
	"slices"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

var (
	pageNavPattern  = regexp.MustCompile(`第\s*(\d+)\s*[页頁].*?共\s*(\d+)\s*[页頁]`)
	m3u8URLPattern  = regexp.MustCompile(`(?i)https?://[^\s"'<>]+\.m3u8[^\s"'<>]*`)
	dateInURLPattern = regexp.MustCompile(`/(\d{4})/(\d{2})/(\d{2})/`)
)

// ParseArticlePageConfig extracts the ArticlePageConfig JSON from the
// #article-page-config script tag.
func ParseArticlePageConfig(doc *goquery.Document) *ArticlePageConfig {
	content := doc.Find("#article-page-config").Text()
	if content == "" {
		return nil
	}
	var cfg ArticlePageConfig
	if err := json.Unmarshal([]byte(content), &cfg); err != nil {
		return nil
	}
	return &cfg
}

// ParseGalleryPageHtml extracts gallery metadata from a goquery document,
// including images, videos, tags, and pagination info.
func ParseGalleryPageHtml(doc *goquery.Document, pageIndex int, placeholder string) GalleryPageMetadata {
	result := GalleryPageMetadata{
		CurrentPage: 1,
		TotalPages:  1,
	}

	result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	breadcrumb := doc.Find(`nav[aria-label="Breadcrumb"]`)
	if breadcrumb.Length() > 0 {
		links := breadcrumb.Find("a")
		if links.Length() >= 2 {
			result.Category = strings.TrimSpace(links.Last().Text())
		}
	}

	tagSet := make(map[string]bool)
	doc.Find(`a[href*="/tag/"]`).Each(func(_ int, a *goquery.Selection) {
		text := strings.TrimSpace(a.Text())
		if text != "" && text != "标签" && len(text) < 30 {
			tagSet[text] = true
		}
	})
	for tag := range tagSet {
		result.Tags = append(result.Tags, tag)
	}

	doc.Find("nav").Each(func(_ int, nav *goquery.Selection) {
		text := nav.Text()
		if m := pageNavPattern.FindStringSubmatch(text); len(m) >= 3 {
			result.CurrentPage = atoiSafe(m[1])
			result.TotalPages = atoiSafe(m[2])
		}
	})

	article := doc.Find("article").First()
	if article.Length() > 0 {
		article.Find("img").Each(func(_ int, img *goquery.Selection) {
			url := firstNonEmpty(img.AttrOr("data-src", ""),
				img.AttrOr("data-original-src", ""),
				img.AttrOr("data-original", ""),
				img.AttrOr("data-lazy-src", ""),
				img.AttrOr("src", ""))

			if url != "" && !strings.Contains(url, placeholder) &&
				!strings.Contains(url, "/static/images/Loading") &&
				!strings.HasPrefix(url, "data:image/") {
				result.Images = append(result.Images, GalleryImageEntry{
					URL:       url,
					PageIndex: pageIndex,
				})
			}
		})

		// Use the first collected image as the gallery cover instead of
		// running a separate selection loop over article <img> elements.
		// The first image (ordered by page position) is the most
		// representative thumbnail for the gallery.
		if result.CoverURL == "" && len(result.Images) > 0 {
			result.CoverURL = result.Images[0].URL
		}
	}

	doc.Find(`video source[src*=".m3u8"]`).Each(func(_ int, s *goquery.Selection) {
		src := s.AttrOr("src", "")
		if src != "" && !slices.Contains(result.Videos, src) {
			result.Videos = append(result.Videos, src)
		}
	})

	doc.Find(`video source[src*=".mp4"]`).Each(func(_ int, s *goquery.Selection) {
		src := s.AttrOr("src", "")
		if src != "" && !slices.Contains(result.Videos, src) {
			result.Videos = append(result.Videos, src)
		}
	})

	doc.Find("script").Each(func(_ int, script *goquery.Selection) {
		content := script.Text()
		matches := m3u8URLPattern.FindAllString(content, -1)
		for _, url := range matches {
			if !slices.Contains(result.Videos, url) {
				result.Videos = append(result.Videos, url)
			}
		}
	})

	// Extract publish time from article time element (most reliable source).
	article.Find("time").Each(func(_ int, t *goquery.Selection) {
		if result.PublishTime != "" {
			return
		}
		// Try datetime attribute first (ISO 8601 format), then text content.
		datetime := t.AttrOr("datetime", "")
		if datetime != "" && len(datetime) >= 10 {
			result.PublishTime = datetime[:10]
			return
		}
		text := strings.TrimSpace(t.Text())
		if text != "" {
			result.PublishTime = text
		}
	})

	// Fallback to JSON-LD VideoObject uploadDate.
	doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, script *goquery.Selection) {
		if result.PublishTime != "" {
			return
		}
		content := script.Text()
		var data struct {
			Type       string `json:"@type"`
			UploadDate string `json:"uploadDate"`
		}
		if err := json.Unmarshal([]byte(content), &data); err == nil {
			if data.Type == "VideoObject" && data.UploadDate != "" {
				if len(data.UploadDate) >= 10 {
					result.PublishTime = data.UploadDate[:10]
				}
			}
		}
	})

	// Final fallback: extract date from cover URL path.
	if result.PublishTime == "" && result.CoverURL != "" {
		if m := dateInURLPattern.FindStringSubmatch(result.CoverURL); len(m) >= 4 {
			result.PublishTime = m[1] + "-" + m[2] + "-" + m[3]
		}
	}

	return result
}

// ExtMetadata holds extracted metadata for extended metadata views.
type ExtMetadata struct {
	H1Title       string
	Category      string
	Tags          []string
	KeywordStr    string
	CoverURL      string
	DocumentTitle string
}

// ParseExtMetadata extracts extended metadata from a goquery document.
func ParseExtMetadata(doc *goquery.Document, placeholder string) ExtMetadata {
	var result ExtMetadata
	result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())

	breadcrumb := doc.Find(`nav[aria-label="Breadcrumb"]`)
	if breadcrumb.Length() > 0 {
		links := breadcrumb.Find("a")
		if links.Length() >= 2 {
			result.Category = strings.TrimSpace(links.Last().Text())
		}
	}

	tagSet := make(map[string]bool)
	doc.Find(`a[href*="/tag/"]`).Each(func(_ int, a *goquery.Selection) {
		text := strings.TrimSpace(a.Text())
		if text != "" && text != "标签" && len(text) < 30 && !tagSet[text] {
			tagSet[text] = true
			result.Tags = append(result.Tags, text)
		}
	})

	result.KeywordStr = doc.Find(`meta[name="keywords"]`).AttrOr("content", "")

	// Extract the first non-placeholder image from the article as the
	// cover/thumbnail for search results and preview cards. This is
	// distinct from the gallery detail-page cover logic (which uses
	// the first uploaded image from the image collection).
	article := doc.Find("article").First()
	if article.Length() > 0 {
		article.Find("img").Each(func(_ int, img *goquery.Selection) {
			if result.CoverURL != "" {
				return
			}
			url := firstNonEmpty(img.AttrOr("data-src", ""),
				img.AttrOr("data-original-src", ""),
				img.AttrOr("data-original", ""),
				img.AttrOr("src", ""))
			if url != "" && !strings.Contains(url, placeholder) &&
				!strings.Contains(url, "/static/images/Loading") {
				result.CoverURL = url
			}
		})
	}

	result.DocumentTitle = strings.TrimSpace(doc.Find("title").First().Text())
	return result
}

// SearchEntry represents a single search result from a listing page.
type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// ParseSearchResults extracts search results from a listing page document.
func ParseSearchResults(doc *goquery.Document, baseURL, placeholder string) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	doc.Find("article").Each(func(_ int, article *goquery.Selection) {
		link := article.Find(`a[href*="/article/"]`).First()
		if link.Length() == 0 {
			return
		}
		href, exists := link.Attr("href")
		if !exists || href == "" || seen[href] {
			return
		}

		fullURL := resolveURL(href, baseURL)
		if fullURL == "" || seen[fullURL] {
			return
		}
		seen[fullURL] = true

		img := article.Find("img").First()
		coverURL := resolveImageURL(img, baseURL, placeholder)

		titleEl := article.Find("h2 a").First()
		if titleEl.Length() == 0 {
			titleEl = link
		}
		title := titleEl.AttrOr("title", "")
		if title == "" {
			title = strings.TrimSpace(titleEl.Text())
		}
		if title == "" {
			title = link.AttrOr("title", "")
		}

		timeEl := article.Find("footer time").First()
		date := strings.TrimSpace(timeEl.Text())

		results = append(results, SearchEntry{
			URL:      fullURL,
			Title:    title,
			CoverURL: coverURL,
			Date:     date,
		})
	})

	if len(results) > 30 {
		results = results[:30]
	}
	return results
}

// ZipInfoFromHtml holds parsed ZIP download information.
type ZipInfoFromHtml struct {
	Title          string
	FileCount      int
	FileSizeText   string
	ImageDimensions string
	Password       string
	DownloadURL    string
	Provider       string
	RequiresLogin  bool
	RequiresEmail  bool
}

// ParseZipInfoFromHtml extracts ZIP download info from a document.
func ParseZipInfoFromHtml(doc *goquery.Document, domain string) *ZipInfoFromHtml {
	box := doc.Find(".download-info-box")
	section := doc.Find(".download-section")
	btn := doc.Find(".btn-download")

	if box.Length() == 0 && section.Length() == 0 {
		return nil
	}

	info := &ZipInfoFromHtml{}
	info.Title = strings.TrimSpace(box.Find(".info-title").Text())

	box.Find(".info-item").Each(func(_ int, item *goquery.Selection) {
		label := strings.TrimSpace(item.Find("strong").Text())
		text := strings.TrimSpace(strings.Replace(item.Text(), label, "", 1))

		if strings.Contains(label, "文件数量") || strings.Contains(label, "Files") {
			if m := regexp.MustCompile(`(\d+)`).FindString(text); m != "" {
				info.FileCount = atoiSafe(m)
			}
		} else if strings.Contains(label, "文件大小") || strings.Contains(label, "Size") {
			info.FileSizeText = text
		} else if strings.Contains(label, "图片尺寸") || strings.Contains(label, "Dimensions") {
			info.ImageDimensions = text
		} else if strings.Contains(label, "密码") || strings.Contains(label, "Password") {
			input := item.Find(".password-input")
			if val, exists := input.Attr("value"); exists && val != "" {
				info.Password = val
			} else {
				info.Password = text
			}
		}
	})

	if btn.Length() > 0 {
		info.Provider = btn.AttrOr("data-provider", "")
		href := btn.AttrOr("href", "")
		label := strings.TrimSpace(btn.Find(".download-label").Text())

		if info.Provider == "mediafire" || strings.Contains(strings.ToLower(label), "mediafire") {
			info.Provider = "MediaFire"
		}

		if strings.HasPrefix(href, "http") && href != "#" {
			info.DownloadURL = href
		} else if strings.HasPrefix(href, "/") && !strings.Contains(href, "/auth/login") && href != "#" {
			info.DownloadURL = domain + href
		}

		if btn.HasClass("is-locked") || strings.Contains(href, "/auth/login") {
			info.RequiresLogin = true
		}
	}

	noticeText := strings.TrimSpace(doc.Find(".download-notice-text").Text())
	if strings.Contains(noticeText, "登录") || strings.Contains(noticeText, "Login") {
		info.RequiresLogin = true
	}
	if strings.Contains(noticeText, "密码") || strings.Contains(noticeText, "验证") || strings.Contains(noticeText, "Verify") {
		info.RequiresEmail = true
	}

	if info.FileCount == 0 && info.FileSizeText == "" && info.DownloadURL == "" {
		return nil
	}

	return info
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}


func atoiSafe(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func resolveURL(href, baseURL string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return "https:" + href
	}
	if strings.HasPrefix(href, "/") {
		return strings.TrimRight(baseURL, "/") + href
	}
	return href
}

func resolveImageURL(img *goquery.Selection, baseURL, placeholder string) string {
	attrs := []string{"data-original-src", "data-src", "data-original", "src"}
	for _, attr := range attrs {
		val, exists := img.Attr(attr)
		if !exists || val == "" {
			continue
		}
		if strings.Contains(val, placeholder) || strings.Contains(val, "/static/images/Loading") {
			continue
		}
		if strings.HasPrefix(val, "data:") {
			continue
		}
		return resolveURL(val, baseURL)
	}
	return ""
}
