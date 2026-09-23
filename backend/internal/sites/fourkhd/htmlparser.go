package fourkhd

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// ParseGalleryPageHtml extracts gallery metadata from a goquery document.
func ParseGalleryPageHtml(doc *goquery.Document, pageIndex int) GalleryPageMetadata {
	result := GalleryPageMetadata{
		CurrentPage: 1,
		TotalPages:  1,
	}

	// Title from h3.wp-block-post-title
	result.H1Title = strings.TrimSpace(doc.Find("h3.wp-block-post-title").First().Text())
	if result.H1Title == "" {
		result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	}
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	// Canonical URL for category extraction
	canonical, exists := doc.Find(`link[rel="canonical"]`).First().Attr("href")
	if exists {
		cat, _ := ExtractContentID(canonical)
		result.Category = cat
	}

	// Pagination — parse .page-links
	pageLinks := doc.Find(".page-links .numpages")
	pageLinks.Each(func(_ int, s *goquery.Selection) {
		href, exists := s.Find("a").Attr("href")
		if exists {
			pn := ExtractPageNum(href)
			if pn > result.TotalPages {
				result.TotalPages = pn
			}
		}
	})

	// Also check current page
	currentSpan := doc.Find(".page-links .numpages.current span").First()
	if currentSpan.Length() > 0 {
		text := strings.TrimSpace(currentSpan.Text())
		if n := atoiSafe(text); n > 0 {
			result.CurrentPage = n
		}
	}

	// Images — extract from entry-content area
	// 4KHD images are in <a href="...4khd.com...webp"><img src="..."></a> pattern
	contentArea := doc.Find(".entry-content").First()
	if contentArea.Length() == 0 {
		contentArea = doc.Find("main").First()
	}

	contentArea.Find("a").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if !exists || !strings.Contains(href, "4khd.com") {
			return
		}
		// Check if href ends with image extension
		lowerHref := strings.ToLower(href)
		if !strings.Contains(lowerHref, ".webp") &&
			!strings.Contains(lowerHref, ".jpg") &&
			!strings.Contains(lowerHref, ".png") &&
			!strings.Contains(lowerHref, ".jpeg") {
			return
		}

		img := a.Find("img").First()
		if img.Length() == 0 {
			return
		}

		src, _ := img.Attr("src")
		if src == "" {
			src, _ = img.Attr("data-src")
		}

		// Skip related post thumbnails
		if strings.Contains(src, "4KHD-beautifulGirls") ||
			strings.Contains(src, "wp-post-image") ||
			img.HasClass("wp-post-image") ||
			img.HasClass("external-img") {
			return
		}

		if src != "" && !strings.HasPrefix(src, "data:") {
			result.Images = append(result.Images, GalleryImageEntry{
				URL:       src,
				PageIndex: pageIndex,
			})
		}
	})

	// Cover = first image
	if len(result.Images) > 0 {
		result.CoverURL = result.Images[0].URL
	}

	// Publish time from meta tag
	doc.Find(`meta[property="article:published_time"]`).Each(func(_ int, s *goquery.Selection) {
		if result.PublishTime != "" {
			return
		}
		content, exists := s.Attr("content")
		if exists && len(content) >= 10 {
			result.PublishTime = content[:10]
		}
	})

	// Fallback: JSON-LD datePublished
	if result.PublishTime == "" {
		doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
			if result.PublishTime != "" {
				return
			}
			content := s.Text()
			var data struct {
				Graph []struct {
					Type        string `json:"@type"`
					DatePublished string `json:"datePublished"`
				} `json:"@graph"`
			}
			if err := json.Unmarshal([]byte(content), &data); err == nil {
				for _, item := range data.Graph {
					if item.Type == "WebPage" && item.DatePublished != "" {
						if len(item.DatePublished) >= 10 {
							result.PublishTime = item.DatePublished[:10]
						}
					}
				}
			}
		})
	}

	return result
}

// ParseDownloadInfo extracts TeraBox download info from the document.
func ParseDownloadInfo(doc *goquery.Document) *DownloadInfo {
	info := &DownloadInfo{Provider: "TeraBox"}

	// Password — format: "Extracting passwords: </p><p>4KHD</p>"
	// In goquery, we need to find the text after "Extracting passwords:"
	doc.Find(".entry-content p").Each(func(_ int, p *goquery.Selection) {
		text := strings.TrimSpace(p.Text())
		if strings.Contains(text, "Extracting passwords") {
			// The password is in the next <p> sibling
			next := p.Next()
			if next.Length() > 0 {
				info.Password = strings.TrimSpace(next.Text())
			}
		}
	})

	// Download link
	doc.Find(`a[href*="m.4khd.com"]`).Each(func(_ int, a *goquery.Selection) {
		if info.DownloadURL != "" {
			return
		}
		href, exists := a.Attr("href")
		if exists && strings.Contains(href, "m.4khd.com") {
			info.DownloadURL = href
		}
	})

	// File size and count from title
	titleText := strings.TrimSpace(doc.Find("h3.wp-block-post-title").First().Text())
	if titleText == "" {
		titleText = strings.TrimSpace(doc.Find("title").First().Text())
	}

	if m := titleSizePattern.FindStringSubmatch(titleText); len(m) >= 3 {
		info.FileSize = m[1]
		info.FileCount = atoiSafe(m[2])
	}

	if info.DownloadURL == "" && info.Password == "" {
		return nil
	}

	return info
}

// SearchEntry represents a single search result from a listing page.
type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// ParseSearchResults extracts gallery links from a listing/search page.
func ParseSearchResults(doc *goquery.Document, baseURL string) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	// 4KHD listing pages use #basicE or .wp-block-latest-posts
	doc.Find("#basicE a, .wp-block-latest-posts a").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if !exists || !strings.Contains(href, "/content/") {
			return
		}
		if seen[href] {
			return
		}
		seen[href] = true

		fullURL := resolveURL(href, baseURL)
		img := a.Find("img").First()
		coverURL, _ := img.Attr("src")
		if coverURL == "" {
			coverURL, _ = img.Attr("data-src")
		}
		coverURL = resolveURL(coverURL, baseURL)

		title := strings.TrimSpace(a.Find("p").Text())
		if title == "" {
			title = strings.TrimSpace(img.AttrOr("alt", ""))
		}

		results = append(results, SearchEntry{
			URL:      fullURL,
			Title:    title,
			CoverURL: coverURL,
		})
	})

	return results
}

// ParseRelatedGalleries extracts related gallery links from a detail page.
func ParseRelatedGalleries(doc *goquery.Document) []SearchEntry {
	var results []SearchEntry

	doc.Find("#basicE a").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if !exists || !strings.Contains(href, "/content/") {
			return
		}

		img := a.Find("img").First()
		coverURL, _ := img.Attr("src")
		title := strings.TrimSpace(a.Find("p").Text())

		results = append(results, SearchEntry{
			URL:      href,
			Title:    title,
			CoverURL: coverURL,
		})
	})

	return results
}

// cleanTitle removes the file size/photo count suffix from a title.
// Example: "屿鱼 欧根亲王 兔女郎[258MB-81photos]" → "屿鱼 欧根亲王 兔女郎"
func cleanTitle(rawTitle string) string {
	title := strings.TrimSpace(rawTitle)
	// Remove [size-count] suffix
	title = titleSizePattern.ReplaceAllString(title, "")
	// Remove (size)(count) suffix for variant format
	title = regexp.MustCompile(`\(\d+(?:\.\d+)?(?:MB|GB)\)\(\d+photos\)$`).ReplaceAllString(title, "")
	// Remove site suffix
	title = regexp.MustCompile(`\s*[-–—]\s*4KHD\s*$`).ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}

// extractProtagonist extracts the model/cosplayer name from a gallery title.
// 4KHD format: "protagonist description[size-count]"
// The protagonist is the first segment before double-space or separator.
func extractProtagonist(title string) string {
	cleaned := cleanTitle(title)
	if cleaned == "" {
		return ""
	}

	// Try double-space separator first (4KHD common pattern)
	parts := strings.Split(cleaned, "  ")
	if len(parts) >= 2 {
		return strings.TrimSpace(parts[0])
	}

	// Try en-dash / em-dash separator
	separators := []string{" – ", " — ", " - "}
	for _, sep := range separators {
		if idx := strings.Index(cleaned, sep); idx > 0 {
			candidate := strings.TrimSpace(cleaned[:idx])
			if len(candidate) >= 2 && len(candidate) <= 50 {
				return candidate
			}
		}
	}

	// Fallback: first word
	words := strings.Fields(cleaned)
	if len(words) > 0 {
		return words[0]
	}

	return ""
}

// extractDescription extracts the description part from a gallery title.
func extractDescription(title, protagonist string) string {
	cleaned := cleanTitle(title)
	if cleaned == "" {
		return ""
	}
	if protagonist != "" && strings.HasPrefix(cleaned, protagonist) {
		desc := strings.TrimPrefix(cleaned, protagonist)
		desc = strings.TrimLeft(desc, " \t–—-")
		return strings.TrimSpace(desc)
	}
	return cleaned
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
