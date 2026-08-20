package xsnvshen

import (
	"regexp"
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

// thumbPattern matches the thumbnail size prefix in image URLs.
// e.g. "thumb_600x900/" should be stripped to get the original image URL.
var thumbPattern = regexp.MustCompile(`thumb_\d+x\d+/`)

// ParseGalleryPageHtml extracts gallery metadata from a parsed album page,
// collecting image URLs from data-original attributes and deriving
// model/album identifiers from the first image path segment.
//
// Upgrade: Uses more precise selector ".gallery .swi-hd img" to capture
// ALL images including the cover (class="nolazy"), and normalizes
// thumbnail URLs back to original quality. Also extracts protagonist
// name from meta description for cleaner model identification.
func ParseGalleryPageHtml(doc *goquery.Document, _ int) GalleryPageMetadata {
	result := GalleryPageMetadata{
		Tags:   []string{},
		Images: []GalleryImageEntry{},
	}

	result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	// Extract protagonist from meta description (most reliable source)
	// Pattern: "模特@模特名" or "模特:模特名"
	if metaDesc := doc.Find(`meta[name="description"]`).First(); metaDesc.Length() > 0 {
		descContent := metaDesc.AttrOr("content", "")
		if modelName := ExtractModelFromDescription(descContent); modelName != "" {
			result.Protagonist = modelName
		}
	}

	tagSet := make(map[string]bool)
	doc.Find(`a[href*="/album/t"]`).Each(func(_ int, el *goquery.Selection) {
		text := strings.TrimSpace(el.Text())
		if text != "" && len(text) < 30 && !tagSet[text] {
			tagSet[text] = true
			result.Tags = append(result.Tags, text)
		}
	})

	timeEl := doc.Find("#time").First()
	if timeEl.Length() > 0 {
		timeText := strings.TrimSpace(timeEl.Text())
		if m := datePattern.FindStringSubmatch(timeText); len(m) >= 2 {
			result.PublishTime = m[1]
		}
	}

	// Primary: use .gallery .swi-hd selector which captures all images
	// including the cover (class="nolazy") and lazy-loaded ones.
	seenURLs := make(map[string]bool)
	doc.Find(".gallery .swi-hd img").Each(func(index int, img *goquery.Selection) {
		// Prefer data-original (contains the real image URL)
		dataOriginal := img.AttrOr("data-original", "")
		src := img.AttrOr("src", "")

		fullURL := normalizeImageURL(dataOriginal, src)
		if fullURL == "" || seenURLs[fullURL] {
			return
		}
		seenURLs[fullURL] = true

		// Set cover if not yet set (first image is always the cover)
		if result.CoverURL == "" {
			result.CoverURL = fullURL
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

	// Fallback: if .gallery selector found nothing, try old selectors
	if len(result.Images) == 0 {
		fallbackExtractImages(doc, &result)
	}

	return result
}

// normalizeImageURL converts thumbnail URLs to original quality URLs.
// Handles the following cases:
//   - Protocol-relative URLs (//img.xsnvshen.co/...) → add https: prefix
//   - Thumbnail URLs (...thumb_600x900/album/...) → strip thumb prefix for original
func normalizeImageURL(dataOriginal, src string) string {
	raw := dataOriginal
	if raw == "" {
		raw = src
	}
	if raw == "" {
		return ""
	}

	// Skip loading GIFs and data URIs
	if strings.Contains(raw, "loading.gif") || strings.HasPrefix(raw, "data:") {
		return ""
	}

	// Add protocol if missing
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}

	// Strip thumbnail size prefix to get original image URL
	// e.g. https://img.xsnvshen.co/thumb_600x900/album/0/45373/001.jpg
	//   → https://img.xsnvshen.co/album/0/45373/001.jpg
	raw = thumbPattern.ReplaceAllString(raw, "")

	return raw
}

// fallbackExtractImages provides backward-compatible extraction when
// the primary .gallery selector fails to find images.
func fallbackExtractImages(doc *goquery.Document, result *GalleryPageMetadata) {
	// Try old selector: img.origin_image.lazy
	doc.Find("img.origin_image.lazy").Each(func(index int, img *goquery.Selection) {
		dataOriginal := img.AttrOr("data-original", "")
		src := img.AttrOr("src", "")

		fullURL := normalizeImageURL(dataOriginal, src)
		if fullURL == "" {
			return
		}

		if result.CoverURL == "" {
			result.CoverURL = fullURL
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

	// If still no images, try #bigImg src and #viewbigimg href from cover
	if len(result.Images) == 0 {
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
	}
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
