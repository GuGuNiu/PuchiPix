package aimeizizi

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/xutil"
)

var httpScraperLogger = infra.NewLogger("AimeiziziProvider")

// ScrapeDeps defines the callbacks the HTTP scraper needs from the
// provider, decoupling scraping logic from provider-specific concerns.
type ScrapeDeps interface {
	ResolveURL(url, domain string) string
	CleanTitle(rawTitle string) string
	ExtractProtagonist(title string, tags []string) string
	ExtractDescription(title, protagonist string) string
	CheckBlockedAsync(ctx context.Context, title, category, protagonist string) (sites.BlockCheckResult, error)
	GetDomains() []string
	GetPlaceholder() string
}

// ScrapeGalleryHTTP performs HTTP-only gallery scraping with multi-domain
// failover, mirroring the TypeScript scrape-gallery-http implementation.
func ScrapeGalleryHTTP(ctx context.Context, pageURL string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	articleID := ExtractArticleID(pageURL)
	domains := deps.GetDomains()
	urlDomain := ExtractDomainFromUrl(pageURL, domains)

	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(domains)

	if urlDomain != "" {
		for i, d := range orderedDomains {
			if d == urlDomain {
				orderedDomains = append(orderedDomains[:i], orderedDomains[i+1:]...)
				orderedDomains = append([]string{urlDomain}, orderedDomains...)
				break
			}
		}
	}

	var doc *goquery.Document
	var usedDomain string

	for _, domain := range orderedDomains {
		tryURL := pageURL
		if articleID != "" {
			tryURL = domain + "/article/" + articleID + "/"
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		result, err := fetchAndParse(ctx, tryURL, domain)
		if err != nil {
			httpScraperLogger.Debug("HTTP fetch failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		if result.wafBlocked {
			tracker.MarkRateLimited(domain)
			httpScraperLogger.Warn("WAF block detected",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"detail": result.wafDetail,
				}})
			continue
		}

		if result.statusCode == 403 || result.statusCode == 429 {
			tracker.MarkRateLimited(domain)
			continue
		}
		if result.statusCode == 404 {
			continue
		}

		if result.doc == nil {
			continue
		}

		articleEl := result.doc.Find("article").First()
		h1Text := strings.TrimSpace(result.doc.Find("h1").First().Text())
		titleText := strings.TrimSpace(result.doc.Find("title").First().Text())
		if articleEl.Length() == 0 && h1Text == "" && titleText == "" {
			continue
		}

		doc = result.doc
		usedDomain = domain
		tracker.MarkHealthy(domain)
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all HTTP domains failed to fetch page")
	}

	firstPageData := ParseGalleryPageHtml(doc, 0, deps.GetPlaceholder())
	pageConfig := ParseArticlePageConfig(doc)

	configTotalPages := 0
	if pageConfig != nil {
		configTotalPages = pageConfig.Pagination.TotalPages
	}

	totalPages := firstPageData.TotalPages
	if configTotalPages > totalPages {
		totalPages = configTotalPages
	}
	if totalPages > stealth.MaxGalleryPages {
		totalPages = stealth.MaxGalleryPages
	}

	allImages := []sites.GalleryImageItem{}
	allVideos := []sites.GalleryVideoItem{}
	imageUrlSet := make(map[string]bool)
	videoUrlSet := make(map[string]bool)

	orderIndex := 0
	for _, img := range firstPageData.Images {
		fullURL := deps.ResolveURL(img.URL, usedDomain)
		if fullURL != "" && !imageUrlSet[fullURL] {
			imageUrlSet[fullURL] = true
			allImages = append(allImages, sites.GalleryImageItem{
				URL:        fullURL,
				PageIndex:  img.PageIndex,
				OrderIndex: orderIndex,
			})
			orderIndex++
		}
	}
	for _, videoURL := range firstPageData.Videos {
		fullURL := deps.ResolveURL(videoURL, usedDomain)
		if fullURL != "" && !videoUrlSet[fullURL] {
			videoUrlSet[fullURL] = true
			allVideos = append(allVideos, sites.GalleryVideoItem{URL: fullURL})
		}
	}

	zipInfo := ParseZipInfoFromHtml(doc, usedDomain)

	for pageNum := 2; pageNum <= totalPages; pageNum++ {
		select {
		case <-ctx.Done():
			break
		default:
		}

		stealth.Sleep(stealth.GalleryHTTPDelayMin, stealth.GalleryHTTPDelayMax)

		pageURLConstructed := usedDomain + "/article/" + articleID + "/page/" + itoa(pageNum) + "/"
		pageData, err := fetchGalleryPage(ctx, pageURLConstructed, usedDomain, articleID, pageNum, deps.GetPlaceholder())

		if err != nil {
			httpScraperLogger.Debug("Page fetch failed, trying fallback",
				infra.LogContext{Extra: map[string]any{
					"page":  pageNum,
					"error": err.Error(),
				}})

			fallbackDomains := tracker.GetAllDomainsOrdered(deps.GetDomains())
			for _, fbDomain := range fallbackDomains {
				if fbDomain == usedDomain {
					continue
				}
				fbURL := fbDomain + "/article/" + articleID + "/page/" + itoa(pageNum) + "/"
				pageData, err = fetchGalleryPage(ctx, fbURL, fbDomain, articleID, pageNum, deps.GetPlaceholder())
				if err == nil {
					usedDomain = fbDomain
					break
				}
			}
		}

		if pageData != nil {
			for _, img := range pageData.Images {
				fullURL := deps.ResolveURL(img.URL, usedDomain)
				if fullURL != "" && !imageUrlSet[fullURL] {
					imageUrlSet[fullURL] = true
					allImages = append(allImages, sites.GalleryImageItem{
						URL:        fullURL,
						PageIndex:  img.PageIndex,
						OrderIndex: orderIndex,
					})
					orderIndex++
				}
			}
			for _, videoURL := range pageData.Videos {
				fullURL := deps.ResolveURL(videoURL, usedDomain)
				if fullURL != "" && !videoUrlSet[fullURL] {
					videoUrlSet[fullURL] = true
					allVideos = append(allVideos, sites.GalleryVideoItem{URL: fullURL})
				}
			}
		}
	}

	title := deps.CleanTitle(firstPageData.H1Title)
	if title == "" {
		title = deps.CleanTitle(firstPageData.RawTitle)
	}

	protagonist := deps.ExtractProtagonist(title, firstPageData.Tags)
	description := deps.ExtractDescription(title, protagonist)

	// Use a fresh context for blocklist check to avoid timeout when
	// the scrape context has expired after long HTTP fetch attempts.
	blockCheck, err := deps.CheckBlockedAsync(context.Background(), title, firstPageData.Category, protagonist)
	if err != nil {
		return nil, fmt.Errorf("check content blocked: %w", err)
	}
	if blockCheck.Blocked {
		return nil, fmt.Errorf("content blocked: %s", blockCheck.Reason)
	}

	metaKeywordsStr := doc.Find(`meta[name="keywords"]`).AttrOr("content", "")
	metaKeywords := []string{}
	for _, kw := range strings.Split(metaKeywordsStr, ",") {
		kw = strings.TrimSpace(kw)
		if kw != "" && len(kw) < 50 {
			metaKeywords = append(metaKeywords, kw)
		}
	}

	allTags := xutil.UniqueStrings(append(append([]string{}, firstPageData.Tags...), metaKeywords...), true)

	zipInfoResult := convertZipInfo(zipInfo)

	result := &sites.GalleryScrapeResult{
		SourceURL:     pageURL,
		Title:         title,
		Protagonist:   protagonist,
		Description:   description,
		Category:      firstPageData.Category,
		Tags:          allTags,
		CoverURL:      deps.ResolveURL(firstPageData.CoverURL, usedDomain),
		PublishTime:   firstPageData.PublishTime,
		Images:        allImages,
		Videos:        allVideos,
		PageCount:     totalPages,
		ImageCount:    len(allImages),
		VideoCount:    len(allVideos),
		ScrapedDomain: usedDomain,
		ZipInfo:       zipInfoResult,
	}

	httpScraperLogger.Info("HTTP scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"images":    len(allImages),
			"videos":    len(allVideos),
			"pages":     totalPages,
			"domain":    usedDomain,
		}})

	return result, nil
}

type fetchResult struct {
	doc        *goquery.Document
	statusCode int
	wafBlocked bool
	wafDetail  string
}

func fetchAndParse(ctx context.Context, url, domain string) (*fetchResult, error) {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, domain)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header = headers
	// Remove Accept-Encoding so the HTTP transport can use gzip (which Go
	// supports) instead of zstd/br (which Go doesn't support natively).
	// The stealth headers request "gzip, deflate, br, zstd" to mimic Chrome,
	// but Go can't decompress zstd/br, resulting in unreadable HTML.
	req.Header.Del("Accept-Encoding")

	client := stealth.NewStealthClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		httpScraperLogger.Debug("fetchAndParse failed", map[string]interface{}{
			"domain": domain,
			"url":    url,
			"error":  err.Error(),
		})
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	html := string(body)
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("parse HTML: %w", err)
	}

	wafResult := stealth.DetectWaf(resp.StatusCode, html, doc)

	h1Text := strings.TrimSpace(doc.Find("h1").First().Text())
	titleText := strings.TrimSpace(doc.Find("title").First().Text())
	httpScraperLogger.Debug("fetchAndParse OK", map[string]interface{}{
		"domain":     domain,
		"status":     resp.StatusCode,
		"wafBlocked": wafResult.Blocked,
		"wafDetail":  wafResult.Detail,
		"htmlLen":    len(html),
		"h1":         h1Text,
		"title":      titleText,
	})

	return &fetchResult{
		doc:        doc,
		statusCode: resp.StatusCode,
		wafBlocked: wafResult.Blocked,
		wafDetail:  wafResult.Detail,
	}, nil
}

func fetchGalleryPage(ctx context.Context, url, domain, articleID string, pageNum int, placeholder string) (*GalleryPageMetadata, error) {
	result, err := fetchAndParse(ctx, url, domain)
	if err != nil {
		return nil, err
	}

	if result.statusCode == 403 || result.statusCode == 429 {
		stealth.GetDomainHealthTracker().MarkRateLimited(domain)
		return nil, fmt.Errorf("rate limited: %d", result.statusCode)
	}
	if result.statusCode != 200 || result.doc == nil {
		return nil, fmt.Errorf("HTTP %d", result.statusCode)
	}

	if result.wafBlocked {
		return nil, fmt.Errorf("WAF: %s", result.wafDetail)
	}

	pageData := ParseGalleryPageHtml(result.doc, pageNum-1, placeholder)
	return &pageData, nil
}

func convertZipInfo(info *ZipInfoFromHtml) *sites.GalleryZipInfo {
	if info == nil {
		return nil
	}
	return &sites.GalleryZipInfo{
		Title:           info.Title,
		FileCount:       info.FileCount,
		FileSizeText:    info.FileSizeText,
		ImageDimensions: info.ImageDimensions,
		Password:        info.Password,
		DownloadURL:     info.DownloadURL,
		Provider:        info.Provider,
		RequiresLogin:   info.RequiresLogin,
		RequiresEmail:   info.RequiresEmail,
		OuoURL:          info.OuoURL,
		DownloadSource:  info.DownloadSource,
	}
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

func init() {
	rand.Seed(time.Now().UnixNano())
}
