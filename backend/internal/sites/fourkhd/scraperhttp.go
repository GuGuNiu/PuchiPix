package fourkhd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/xutil"
)

var httpScraperLogger = infra.NewLogger("FourKHDProvider")

type ScrapeDeps interface {
	ResolveURL(url, domain string) string
	CleanTitle(rawTitle string) string
	ExtractProtagonist(title string, tags []string) string
	ExtractDescription(title, protagonist string) string
	CheckBlockedAsync(ctx context.Context, title, category, protagonist string) (sites.BlockCheckResult, error)
	GetDomains() []string
	GetPlaceholder() string
}

// ScrapeGalleryHTTP scrapes a gallery over HTTP, retrying across the site's
// known domains when one of them fails.
func ScrapeGalleryHTTP(ctx context.Context, pageURL string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	domains := deps.GetDomains()
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(domains)

	// The domain embedded in the request URL is preferred over the health-ranked
	// order because the caller's page and its paginated siblings share state.
	urlDomain := ""
	for _, d := range orderedDomains {
		if strings.HasPrefix(pageURL, d) {
			urlDomain = d
			break
		}
	}
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
		if urlDomain != "" && urlDomain != domain {
			tryURL = strings.Replace(pageURL, urlDomain, domain, 1)
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

		h3Text := strings.TrimSpace(result.doc.Find("h3.wp-block-post-title").First().Text())
		titleText := strings.TrimSpace(result.doc.Find("title").First().Text())
		if h3Text == "" && titleText == "" {
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

	firstPageData := ParseGalleryPageHtml(doc, 0)
	downloadInfo := ParseDownloadInfo(doc)

	totalPages := firstPageData.TotalPages
	if totalPages > stealth.MaxGalleryPages {
		totalPages = stealth.MaxGalleryPages
	}

	allImages := []sites.GalleryImageItem{}
	imageUrlSet := make(map[string]bool)

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

	for pageNum := 2; pageNum <= totalPages; pageNum++ {
		select {
		case <-ctx.Done():
			break
		default:
		}

		stealth.Sleep(stealth.GalleryHTTPDelayMin, stealth.GalleryHTTPDelayMax)

		pageURLConstructed := pageURL + "/" + fmt.Sprintf("%d", pageNum)
		if usedDomain != "" && !strings.HasPrefix(pageURLConstructed, usedDomain) {
			pageURLConstructed = usedDomain + strings.TrimPrefix(pageURLConstructed, "")
			for _, d := range orderedDomains {
				if strings.HasPrefix(pageURLConstructed, d) {
					break
				}
			}
		}

		pageData, err := fetchGalleryPage(ctx, pageURLConstructed, usedDomain, pageNum, deps.GetPlaceholder())
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
				fbURL := fbDomain + "/content/" + firstPageData.Category + "/"
				slug := ""
				if m := contentIDPattern.FindStringSubmatch(pageURL); len(m) >= 3 {
					slug = m[2]
				}
				if slug == "" {
					continue
				}
				fbURL += slug + ".html/" + fmt.Sprintf("%d", pageNum)
				pageData, err = fetchGalleryPage(ctx, fbURL, fbDomain, pageNum, deps.GetPlaceholder())
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
		}
	}

	title := deps.CleanTitle(firstPageData.H1Title)
	if title == "" {
		title = deps.CleanTitle(firstPageData.RawTitle)
	}

	protagonist := deps.ExtractProtagonist(title, firstPageData.Tags)
	description := deps.ExtractDescription(title, protagonist)

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

	var zipInfoResult *sites.GalleryZipInfo
	if downloadInfo != nil {
		zipInfoResult = &sites.GalleryZipInfo{
			DownloadURL:  downloadInfo.DownloadURL,
			Password:     downloadInfo.Password,
			FileSizeText: downloadInfo.FileSize,
			FileCount:    downloadInfo.FileCount,
			Provider:     downloadInfo.Provider,
		}
	}

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
		Videos:        []sites.GalleryVideoItem{},
		PageCount:     totalPages,
		ImageCount:    len(allImages),
		VideoCount:    0,
		ScrapedDomain: usedDomain,
		ZipInfo:       zipInfoResult,
	}

	httpScraperLogger.Info("HTTP scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":      pageURL,
			"images":   len(allImages),
			"videos":   0,
			"pages":    totalPages,
			"domain":   usedDomain,
			"download": downloadInfo != nil,
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
	req.Header.Del("Accept-Encoding") // Let Go handle compression

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

	return &fetchResult{
		doc:        doc,
		statusCode: resp.StatusCode,
		wafBlocked: wafResult.Blocked,
		wafDetail:  wafResult.Detail,
	}, nil
}

func fetchGalleryPage(ctx context.Context, url, domain string, pageNum int, placeholder string) (*GalleryPageMetadata, error) {
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

	pageData := ParseGalleryPageHtml(result.doc, pageNum-1)
	return &pageData, nil
}
