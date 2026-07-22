package xsnvshen

import (
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// SearchEntry represents a single result from a listing or search page.
type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// ExtMetadata holds the full metadata extracted from a gallery page,
// mirroring the TypeScript ExtMetadata interface.
type ExtMetadata struct {
	H1Title       string
	Category      string
	Tags          []string
	KeywordStr    string
	CoverURL      string
	DocumentTitle string
	PublishTime   string
	ModelID       string
	AlbumID       string
}

// ParseGalleryPageHtml extracts gallery metadata from a parsed album page,
// collecting image URLs from data-original attributes and deriving
// model/album identifiers from the first image path segment.
func ParseGalleryPageHtml(doc *goquery.Document, _ int) GalleryPageMetadata {
	result := GalleryPageMetadata{
		Tags:   []string{},
		Images: []GalleryImageEntry{},
	}

	result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	tagSet := make(map[string]bool)
	doc.Find(`a[href*="/album/t"]`).Each(func(_ int, el *goquery.Selection) {
		text := strings.TrimSpace(el.Text())
		if text != "" && len(text) < 30 && !tagSet[text] {
			tagSet[text] = true
			result.Tags = append(result.Tags, text)
		}
	})

	bigImg := doc.Find("#bigImg").First()
	if bigImg.Length() > 0 {
		result.CoverURL = bigImg.AttrOr("src", "")
	}
	if result.CoverURL == "" {
		viewBigImg := doc.Find("#viewbigimg").First()
		if viewBigImg.Length() > 0 {
			result.CoverURL = viewBigImg.AttrOr("href", "")
		}
	}

	timeEl := doc.Find("#time").First()
	if timeEl.Length() > 0 {
		timeText := strings.TrimSpace(timeEl.Text())
		if m := datePattern.FindStringSubmatch(timeText); len(m) >= 2 {
			result.PublishTime = m[1]
		}
	}

	doc.Find("img.origin_image.lazy").Each(func(index int, img *goquery.Selection) {
		dataOriginal := img.AttrOr("data-original", "")
		src := img.AttrOr("src", "")

		fullURL := dataOriginal
		if fullURL == "" {
			fullURL = src
		}
		if fullURL == "" {
			return
		}

		result.Images = append(result.Images, GalleryImageEntry{
			URL:       fullURL,
			PageIndex: index,
		})

		if index == 0 {
			modelID, albumID := ExtractModelIDFromImageUrl(fullURL)
			result.ModelID = modelID
			result.AlbumID = albumID
		}
	})

	if result.CoverURL == "" && len(result.Images) > 0 {
		result.CoverURL = result.Images[0].URL
	}

	return result
}

// ParseExtMetadata extracts extended metadata including meta keywords,
// canonical album ID, and breadcrumb category from the document.
func ParseExtMetadata(doc *goquery.Document) ExtMetadata {
	var meta ExtMetadata

	meta.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())

	tagSet := make(map[string]bool)
	meta.Tags = []string{}
	doc.Find(`a[href*="/album/t"]`).Each(func(_ int, a *goquery.Selection) {
		text := strings.TrimSpace(a.Text())
		if text != "" && len(text) < 30 && !tagSet[text] {
			tagSet[text] = true
			meta.Tags = append(meta.Tags, text)
		}
	})

	meta.KeywordStr = doc.Find(`meta[name="keywords"]`).AttrOr("content", "")

	meta.CoverURL = doc.Find("#bigImg").First().AttrOr("src", "")
	if meta.CoverURL == "" {
		meta.CoverURL = doc.Find("#viewbigimg").First().AttrOr("href", "")
	}
	if meta.CoverURL == "" {
		firstImg := doc.Find("img.origin_image.lazy").First()
		meta.CoverURL = firstImg.AttrOr("data-original", "")
		if meta.CoverURL == "" {
			meta.CoverURL = firstImg.AttrOr("src", "")
		}
	}

	timeEl := doc.Find("#time").First()
	if timeEl.Length() > 0 {
		timeText := strings.TrimSpace(timeEl.Text())
		if m := datePattern.FindStringSubmatch(timeText); len(m) >= 2 {
			meta.PublishTime = m[1]
		}
	}

	firstImg := doc.Find("img.origin_image.lazy").First()
	if firstImg.Length() > 0 {
		imgURL := firstImg.AttrOr("data-original", "")
		if imgURL == "" {
			imgURL = firstImg.AttrOr("src", "")
		}
		meta.ModelID, meta.AlbumID = ExtractModelIDFromImageUrl(imgURL)
	}

	if meta.AlbumID == "" {
		canonical := doc.Find(`link[rel="canonical"]`).AttrOr("href", "")
		if m := albumIDPattern.FindStringSubmatch(canonical); len(m) >= 2 {
			meta.AlbumID = m[1]
		}
	}

	selectedCat := doc.Find(".menucat a.selected").First()
	if selectedCat.Length() > 0 {
		meta.Category = strings.TrimSpace(selectedCat.Text())
	}

	meta.DocumentTitle = strings.TrimSpace(doc.Find("title").First().Text())

	return meta
}

// ParseSearchResults extracts album entries from listing or search pages,
// resolving relative URLs against the provided base URL.
func ParseSearchResults(doc *goquery.Document, baseURL string) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	resolveURL := func(raw string) string {
		if raw == "" || strings.HasPrefix(raw, "data:") {
			return ""
		}
		return ResolveRelativeURL(raw, baseURL)
	}

	doc.Find(".album-list li, .pic-list li, .show-list li, .gl-list li").Each(func(_ int, item *goquery.Selection) {
		link := item.Find(`a[href*="/album/"]`).First()
		if link.Length() == 0 {
			return
		}
		href, exists := link.Attr("href")
		if !exists || href == "" || seen[href] {
			return
		}

		fullURL := ResolveRelativeURL(href, baseURL)
		if fullURL == "" || seen[fullURL] {
			return
		}
		seen[fullURL] = true

		img := item.Find("img").First()
		coverURL := resolveURL(img.AttrOr("data-original", ""))
		if coverURL == "" {
			coverURL = resolveURL(img.AttrOr("data-src", ""))
		}
		if coverURL == "" {
			coverURL = resolveURL(img.AttrOr("src", ""))
		}

		titleEl := item.Find("h2 a, h3 a, .title a, .album-title").First()
		title := strings.TrimSpace(titleEl.Text())
		if title == "" {
			title = link.AttrOr("title", "")
		}
		if title == "" {
			title = strings.TrimSpace(link.Text())
		}
		if title == "" {
			title = img.AttrOr("alt", "")
		}

		timeEl := item.Find(".time, .date, time").First()
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

// IsAgeVerificationPage checks whether the document represents the
// anti-addiction interstitial that blocks access to real content.
func IsAgeVerificationPage(doc *goquery.Document) bool {
	title := strings.TrimSpace(doc.Find("title").First().Text())
	return title == "防沉迷提示"
}

// Is404Page detects whether the page is a 404 error page.
func Is404Page(doc *goquery.Document) bool {
	title := strings.TrimSpace(doc.Find("title").First().Text())
	return strings.Contains(title, "404")
}

// ResolveRelativeURL resolves a possibly-relative URL against a base URL,
// handling protocol-relative (//) and absolute-path (/) forms.
func ResolveRelativeURL(raw, baseURL string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "/") {
		for _, domain := range SiteDomains {
			if strings.HasPrefix(baseURL, domain) {
				return domain + raw
			}
		}
		if strings.HasPrefix(baseURL, "http") {
			idx := strings.Index(baseURL[8:], "/")
			if idx >= 0 {
				return baseURL[:8+idx] + raw
			}
			return baseURL + raw
		}
		return raw
	}
	return raw
}
