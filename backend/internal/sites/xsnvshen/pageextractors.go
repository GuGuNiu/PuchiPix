package xsnvshen

import (
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// thumbPattern strips the thumbnail size directory (e.g. "thumb_600x900/")
// that the site inserts into listing-page image URLs.
var thumbPattern = regexp.MustCompile(`thumb_\d+x\d+/`)

func ParseGalleryPageHtml(doc *goquery.Document, _ int) GalleryPageMetadata {
	result := GalleryPageMetadata{
		Tags:   []string{},
		Images: []GalleryImageEntry{},
	}

	result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	// The meta description is the only place the site exposes the model name.
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

	// ".gallery .swi-hd img" also matches the cover element, which carries
	// class="nolazy" instead of a lazy-load marker.
	seenURLs := make(map[string]bool)
	doc.Find(".gallery .swi-hd img").Each(func(index int, img *goquery.Selection) {
		// data-original holds the full-size URL; src holds the lazy-load placeholder.
		dataOriginal := img.AttrOr("data-original", "")
		src := img.AttrOr("src", "")

		fullURL := normalizeImageURL(dataOriginal, src)
		if fullURL == "" || seenURLs[fullURL] {
			return
		}
		seenURLs[fullURL] = true

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

	if len(result.Images) == 0 {
		fallbackExtractImages(doc, &result)
	}

	return result
}

// normalizeImageURL promotes a lazy-loaded image URL to its full-size form by
// adding the missing protocol and removing the thumbnail size directory.
func normalizeImageURL(dataOriginal, src string) string {
	raw := dataOriginal
	if raw == "" {
		raw = src
	}
	if raw == "" {
		return ""
	}

	if strings.Contains(raw, "loading.gif") || strings.HasPrefix(raw, "data:") {
		return ""
	}

	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}

	raw = thumbPattern.ReplaceAllString(raw, "")

	return raw
}

// fallbackExtractImages covers gallery pages that predate the .gallery
// container and expose images through legacy selectors instead.
func fallbackExtractImages(doc *goquery.Document, result *GalleryPageMetadata) {
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

	// Last resort: the cover-only pages expose the image directly.
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

// IsAgeVerificationPage reports whether the document is the site's
// age-verification interstitial rather than real content.
func IsAgeVerificationPage(doc *goquery.Document) bool {
	title := strings.TrimSpace(doc.Find("title").First().Text())
	return title == "防沉迷提示"
}

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
