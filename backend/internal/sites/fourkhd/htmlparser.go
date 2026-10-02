package fourkhd

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

func ParseGalleryPageHtml(doc *goquery.Document, pageIndex int) GalleryPageMetadata {
	result := GalleryPageMetadata{
		CurrentPage: 1,
		TotalPages:  1,
	}

	result.H1Title = strings.TrimSpace(doc.Find("h3.wp-block-post-title").First().Text())
	if result.H1Title == "" {
		result.H1Title = strings.TrimSpace(doc.Find("h1").First().Text())
	}
	result.RawTitle = strings.TrimSpace(doc.Find("title").First().Text())

	canonical, exists := doc.Find(`link[rel="canonical"]`).First().Attr("href")
	if exists {
		cat, _ := ExtractContentID(canonical)
		result.Category = cat
	}

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

	currentSpan := doc.Find(".page-links .numpages.current span").First()
	if currentSpan.Length() > 0 {
		text := strings.TrimSpace(currentSpan.Text())
		if n := atoiSafe(text); n > 0 {
			result.CurrentPage = n
		}
	}

	// Images sit in <a href="...4khd.com...webp"><img src="..."></a> pairs
	// inside .entry-content, which also holds related-post thumbnails.
	contentArea := doc.Find(".entry-content").First()
	if contentArea.Length() == 0 {
		contentArea = doc.Find("main").First()
	}

	contentArea.Find("a").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if !exists || !strings.Contains(href, "4khd.com") {
			return
		}
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

		// Related-post thumbnails reuse the same CDN and extension set, so
		// they must be filtered out by class or filename marker.
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

	if len(result.Images) > 0 {
		result.CoverURL = result.Images[0].URL
	}

	doc.Find(`meta[property="article:published_time"]`).Each(func(_ int, s *goquery.Selection) {
		if result.PublishTime != "" {
			return
		}
		content, exists := s.Attr("content")
		if exists && len(content) >= 10 {
			result.PublishTime = content[:10]
		}
	})

	// Pages without the article:published_time meta tag still expose the date
	// through JSON-LD.
	if result.PublishTime == "" {
		doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
			if result.PublishTime != "" {
				return
			}
			content := s.Text()
			var data struct {
				Graph []struct {
					Type          string `json:"@type"`
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

func ParseDownloadInfo(doc *goquery.Document) *DownloadInfo {
	info := &DownloadInfo{Provider: "TeraBox"}

	// goquery discards the raw HTML, so the password value is read from the
	// <p> that follows the "Extracting passwords:" paragraph.
	doc.Find(".entry-content p").Each(func(_ int, p *goquery.Selection) {
		text := strings.TrimSpace(p.Text())
		if strings.Contains(text, "Extracting passwords") {
			next := p.Next()
			if next.Length() > 0 {
				info.Password = strings.TrimSpace(next.Text())
			}
		}
	})

	doc.Find(`a[href*="m.4khd.com"]`).Each(func(_ int, a *goquery.Selection) {
		if info.DownloadURL != "" {
			return
		}
		href, exists := a.Attr("href")
		if exists && strings.Contains(href, "m.4khd.com") {
			info.DownloadURL = href
		}
	})

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

type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

func ParseSearchResults(doc *goquery.Document, baseURL string) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

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

func cleanTitle(rawTitle string) string {
	title := strings.TrimSpace(rawTitle)
	title = titleSizePattern.ReplaceAllString(title, "")
	title = regexp.MustCompile(`\(\d+(?:\.\d+)?(?:MB|GB)\)\(\d+photos\)$`).ReplaceAllString(title, "")
	title = regexp.MustCompile(`\s*[-–—]\s*4KHD\s*$`).ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}

// Double space is the most common 4KHD title separator, so it is tried
// before the dash variants and a bare first word.
func extractProtagonist(title string) string {
	cleaned := cleanTitle(title)
	if cleaned == "" {
		return ""
	}

	parts := strings.Split(cleaned, "  ")
	if len(parts) >= 2 {
		return strings.TrimSpace(parts[0])
	}

	separators := []string{" – ", " — ", " - "}
	for _, sep := range separators {
		if idx := strings.Index(cleaned, sep); idx > 0 {
			candidate := strings.TrimSpace(cleaned[:idx])
			if len(candidate) >= 2 && len(candidate) <= 50 {
				return candidate
			}
		}
	}

	words := strings.Fields(cleaned)
	if len(words) > 0 {
		return words[0]
	}

	return ""
}

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
