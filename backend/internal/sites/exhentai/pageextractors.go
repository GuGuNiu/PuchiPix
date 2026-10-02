package exhentai

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/stealth"
)

var extractorLogger = infra.NewLogger("ExhentaiProvider")

var (
	datePattern   = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})`)
	numberPattern = regexp.MustCompile(`(\d+)`)
	ratingPattern = regexp.MustCompile(`Average:\s*([\d.]+)`)
	imgSrcPattern = regexp.MustCompile(`<img[^>]+id="img"[^>]+src="([^"]+)"`)
)

type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// ExtendedMetadata aggregates the gallery page fields used for search indexing.
type ExtendedMetadata struct {
	Title       string
	Tags        []string
	Actors      []string
	Categories  []string
	Director    string
	Series      []SeriesEntry
	Blocked     bool
	BlockReason string
}

type SeriesEntry struct {
	URL   string
	Title string
	ID    string
}

type GalleryInfo struct {
	Pages    int
	Posted   string
	CoverURL string
	Uploader string
	Category string
}

type rawMetadata struct {
	H1Title       string
	Uploader      string
	Language      string
	Pages         int
	Posted        string
	FileSize      string
	Rating        float64
	Tags          map[string][]string
	CoverURL      string
	Category      string
	DocumentTitle string
}

// ExtractSearchResults parses search result rows from a listing page,
// supporting both compact (gltc) and extended table layouts.
func ExtractSearchResults(doc *goquery.Document) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	doc.Find("table.itg > tbody > tr").Each(func(_ int, row *goquery.Selection) {
		if row.Index() == 0 {
			return
		}

		if row.Find(`td.itd[colspan="4"]`).Length() > 0 {
			return
		}

		linkEl := row.Find("td.gl3c.glname a").First()
		if linkEl.Length() == 0 {
			return
		}

		href, exists := linkEl.Attr("href")
		if !exists || href == "" || !strings.Contains(href, "/g/") || seen[href] {
			return
		}
		seen[href] = true

		titleEl := row.Find("td.gl3c.glname a div.glink").First()
		title := strings.TrimSpace(titleEl.Text())
		if title == "" {
			title = strings.TrimSpace(linkEl.Text())
		}

		coverImg := row.Find("td.gl2c img").First()
		coverURL := coverImg.AttrOr("data-src", "")
		if coverURL == "" {
			coverURL = coverImg.AttrOr("src", "")
		}

		postedEl := row.Find(`div[id^="posted_"]`).First()
		dateText := strings.TrimSpace(postedEl.Text())
		var date string
		if dateText != "" {
			if m := datePattern.FindStringSubmatch(dateText); len(m) >= 2 {
				date = m[1]
			}
		}

		results = append(results, SearchEntry{
			URL:      href,
			Title:    title,
			CoverURL: coverURL,
			Date:     date,
		})
	})

	if len(results) > 50 {
		results = results[:50]
	}
	return results
}

func ExtractExtendedMetadata(doc *goquery.Document) ExtendedMetadata {
	raw := parseRawMetadata(doc)

	title := CleanExhentaiTitle(raw.H1Title)
	if title == "" {
		title = CleanExhentaiTitle(raw.DocumentTitle)
	}

	var flatTags []string
	for ns, labels := range raw.Tags {
		for _, label := range labels {
			flatTags = append(flatTags, ns+":"+label)
		}
	}

	parodies := raw.Tags["parody"]
	if parodies == nil {
		parodies = raw.Tags["group"]
	}
	characters := raw.Tags["character"]
	actors := append([]string{}, parodies...)
	actors = append(actors, characters...)

	var categories []string
	if raw.Category != "" {
		categories = []string{raw.Category}
	}

	return ExtendedMetadata{
		Title:      title,
		Tags:       flatTags,
		Actors:     actors,
		Categories: categories,
		Director:   raw.Uploader,
		Series:     []SeriesEntry{},
		Blocked:    false,
	}
}

func parseRawMetadata(doc *goquery.Document) rawMetadata {
	var raw rawMetadata
	raw.Tags = make(map[string][]string)

	raw.H1Title = strings.TrimSpace(doc.Find("#gn").First().Text())
	raw.DocumentTitle = strings.TrimSpace(doc.Find("title").First().Text())

	raw.Uploader = strings.TrimSpace(doc.Find("#gdn a").First().Text())

	doc.Find("#gdd table tbody > tr").Each(func(_ int, row *goquery.Selection) {
		label := strings.TrimSpace(row.Find("td.gdt1").Text())
		value := strings.TrimSpace(row.Find("td.gdt2").Text())

		switch {
		case strings.Contains(label, "Language"):
			raw.Language = value
		case strings.Contains(label, "Length") || strings.Contains(label, "Pages"):
			if m := numberPattern.FindString(value); m != "" {
				if n, err := strconv.Atoi(m); err == nil {
					raw.Pages = n
				}
			}
		case strings.Contains(label, "Posted"):
			raw.Posted = value
		case strings.Contains(label, "File Size"):
			raw.FileSize = value
		}
	})

	ratingText := strings.TrimSpace(doc.Find("#gdr #rating_label").First().Text())
	if m := ratingPattern.FindStringSubmatch(ratingText); len(m) >= 2 {
		if r, err := strconv.ParseFloat(m[1], 64); err == nil {
			raw.Rating = r
		}
	}

	doc.Find("#taglist table tbody > tr").Each(func(_ int, row *goquery.Selection) {
		keyEl := row.Find("td.tc").First()
		key := strings.TrimSpace(keyEl.Text())
		key = strings.TrimSuffix(key, ":")

		var values []string
		row.Find("td > div > a").Each(func(_ int, el *goquery.Selection) {
			text := strings.TrimSpace(el.Text())
			if text != "" {
				values = append(values, text)
			}
		})

		if key != "" && len(values) > 0 {
			raw.Tags[key] = values
		}
	})

	coverEl := doc.Find("#gd1 img").First()
	if coverEl.Length() == 0 {
		coverEl = doc.Find("#gdc img").First()
	}
	raw.CoverURL = coverEl.AttrOr("data-src", "")
	if raw.CoverURL == "" {
		raw.CoverURL = coverEl.AttrOr("src", "")
	}

	categoryEl := doc.Find("#gdc .cs").First()
	if categoryEl.Length() == 0 {
		categoryEl = doc.Find(".cs.ct1").First()
	}
	if categoryEl.Length() == 0 {
		categoryEl = doc.Find(".cs.ct2").First()
	}
	if categoryEl.Length() == 0 {
		categoryEl = doc.Find(".cs.ct3").First()
	}
	raw.Category = strings.TrimSpace(categoryEl.Text())

	return raw
}

func ExtractGalleryInfo(doc *goquery.Document) GalleryInfo {
	var info GalleryInfo

	doc.Find("#gdd table tbody > tr").Each(func(_ int, row *goquery.Selection) {
		label := strings.TrimSpace(row.Find("td.gdt1").Text())
		value := strings.TrimSpace(row.Find("td.gdt2").Text())

		if strings.Contains(label, "Length") || strings.Contains(label, "Pages") {
			if m := numberPattern.FindString(value); m != "" {
				if n, err := strconv.Atoi(m); err == nil {
					info.Pages = n
				}
			}
		} else if strings.Contains(label, "Posted") {
			if m := datePattern.FindStringSubmatch(value); len(m) >= 2 {
				info.Posted = m[1]
			}
		}
	})

	coverEl := doc.Find("#gd1 img").First()
	if coverEl.Length() == 0 {
		coverEl = doc.Find("#gdc img").First()
	}
	info.CoverURL = coverEl.AttrOr("data-src", "")
	if info.CoverURL == "" {
		info.CoverURL = coverEl.AttrOr("src", "")
	}

	info.Uploader = strings.TrimSpace(doc.Find("#gdn a").First().Text())

	categoryEl := doc.Find("#gdc .cs").First()
	if categoryEl.Length() == 0 {
		categoryEl = doc.Find(".cs").First()
	}
	info.Category = strings.TrimSpace(categoryEl.Text())

	return info
}

// CollectImagePageLinks gathers all image-page anchor hrefs from
// thumbnail pages, paginating via ?p=N up to MaxGalleryPages.
func CollectImagePageLinks(ctx context.Context, galleryURL string, totalImages int, cookieStr string) []string {
	var allLinks []string
	seen := make(map[string]bool)

	galleryPages := (totalImages + ThumbsPerPage - 1) / ThumbsPerPage
	if galleryPages == 0 {
		galleryPages = 1
	}
	if galleryPages > stealth.MaxGalleryPages {
		galleryPages = stealth.MaxGalleryPages
	}

	for pageNum := 0; pageNum < galleryPages; pageNum++ {
		select {
		case <-ctx.Done():
			return allLinks
		default:
		}

		pageURL := galleryURL
		if pageNum > 0 {
			pageURL = strings.TrimRight(galleryURL, "/") + "/?p=" + strconv.Itoa(pageNum)
			stealth.Sleep(stealth.PageDelayMin, stealth.PageDelayMax)
		}

		html, err := fetchHTML(ctx, pageURL, cookieStr)
		if err != nil {
			extractorLogger.Warn("Failed to fetch thumbnail page",
				infra.LogContext{Extra: map[string]any{
					"page":  pageNum,
					"error": err.Error(),
				}})
			break
		}

		doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			break
		}

		newCount := 0
		doc.Find("#gdt a").Each(func(_ int, a *goquery.Selection) {
			href, exists := a.Attr("href")
			if !exists || href == "" || seen[href] {
				return
			}
			seen[href] = true
			allLinks = append(allLinks, href)
			newCount++
		})

		extractorLogger.Debug("Thumbnail page links collected",
			infra.LogContext{Extra: map[string]any{
				"page":  pageNum + 1,
				"new":   newCount,
				"total": len(allLinks),
			}})

		if newCount == 0 {
			break
		}
	}

	return allLinks
}

// FetchImageURLs resolves each image page to its image URL, pausing between
// batches so the burst does not trigger rate limiting.
func FetchImageURLs(ctx context.Context, imagePageURLs []string, cookieStr string) []string {
	results := make([]string, len(imagePageURLs))

	for i := 0; i < len(imagePageURLs); i += ImageBatchSize {
		select {
		case <-ctx.Done():
			return results
		default:
		}

		end := i + ImageBatchSize
		if end > len(imagePageURLs) {
			end = len(imagePageURLs)
		}

		batch := imagePageURLs[i:end]
		for j, pageURL := range batch {
			imgURL, err := fetchImageURL(ctx, pageURL, cookieStr)
			if err != nil {
				extractorLogger.Debug("Image page fetch failed",
					infra.LogContext{Extra: map[string]any{
						"url":   pageURL,
						"error": err.Error(),
					}})
				continue
			}
			results[i+j] = imgURL
		}

		if end < len(imagePageURLs) {
			stealth.Sleep(stealth.PageDelayMin, stealth.PageDelayMax)
		}

		successCount := 0
		for k := i; k < end; k++ {
			if results[k] != "" {
				successCount++
			}
		}
		extractorLogger.Debug("Image batch processed",
			infra.LogContext{Extra: map[string]any{
				"batch":   i,
				"done":    end,
				"total":   len(imagePageURLs),
				"success": successCount,
			}})
	}

	return results
}

func fetchImageURL(ctx context.Context, pageURL string, cookieStr string) (string, error) {
	html, err := fetchHTML(ctx, pageURL, cookieStr)
	if err != nil {
		return "", err
	}

	if m := imgSrcPattern.FindStringSubmatch(html); len(m) >= 2 {
		return m[1], nil
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return "", err
	}

	src := doc.Find(`img#img`).AttrOr("src", "")
	if src == "" {
		return "", fmt.Errorf("image src not found")
	}
	return src, nil
}

func fetchHTML(ctx context.Context, pageURL string, cookieStr string) (string, error) {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, pageURL)
	if cookieStr != "" {
		headers.Set("Cookie", cookieStr)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header = headers

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}
