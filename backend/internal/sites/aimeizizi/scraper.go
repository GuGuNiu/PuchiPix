package aimeizizi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chromedp/chromedp"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var scraperLogger = infra.NewLogger("AimeiziziProvider")

// ScrapeGalleryBrowser performs chromedp-based gallery scraping as a
// fallback when HTTP scraping fails or returns insufficient content.
func ScrapeGalleryBrowser(ctx context.Context, pageURL string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	articleID := ExtractArticleID(pageURL)
	domains := deps.GetDomains()
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(domains)

	urlDomain := ExtractDomainFromUrl(pageURL, domains)
	if urlDomain != "" {
		for i, d := range orderedDomains {
			if d == urlDomain {
				orderedDomains = append(orderedDomains[:i], orderedDomains[i+1:]...)
				orderedDomains = append([]string{urlDomain}, orderedDomains...)
				break
			}
		}
	}

	var html string
	var usedDomain string

	for _, domain := range orderedDomains {
		tryURL := pageURL
		if articleID != "" {
			tryURL = domain + "/article/" + articleID + "/"
		}

		result, err := navigateAndWait(ctx, tryURL)
		if err != nil {
			scraperLogger.Debug("Browser navigation failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		if result == "" {
			continue
		}

		doc, err := goquery.NewDocumentFromReader(strings.NewReader(result))
		if err != nil {
			continue
		}

		articleEl := doc.Find("article").First()
		if articleEl.Length() == 0 {
			continue
		}

		html = result
		usedDomain = domain
		tracker.MarkHealthy(domain)
		break
	}

	if html == "" {
		return nil, fmt.Errorf("all browser domains failed to fetch page")
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("parse HTML: %w", err)
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

	// Fetch remaining pages via browser navigation.
	for pageNum := 2; pageNum <= totalPages; pageNum++ {
		select {
		case <-ctx.Done():
			break
		default:
		}

		stealth.Sleep(stealth.PageDelayMin, stealth.PageDelayMax)

		pageURLConstructed := usedDomain + "/article/" + articleID + "/page/" + itoa(pageNum) + "/"
		pageHtml, err := navigateAndWait(ctx, pageURLConstructed)
		if err != nil {
			scraperLogger.Debug("Browser page fetch failed",
				infra.LogContext{Extra: map[string]any{
					"page":  pageNum,
					"error": err.Error(),
				}})
			continue
		}

		pageDoc, err := goquery.NewDocumentFromReader(strings.NewReader(pageHtml))
		if err != nil {
			continue
		}

		pageData := ParseGalleryPageHtml(pageDoc, pageNum-1, deps.GetPlaceholder())
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

	zipInfo := ParseZipInfoFromHtml(doc, usedDomain)

	title := deps.CleanTitle(firstPageData.H1Title)
	if title == "" {
		title = deps.CleanTitle(firstPageData.RawTitle)
	}

	protagonist := deps.ExtractProtagonist(title, firstPageData.Tags)
	description := deps.ExtractDescription(title, protagonist)

	// Use a fresh context for blocklist check to avoid timeout when
	// the scrape context has expired after long chromedp navigation.
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

	allTags := uniqueStrings(append(append([]string{}, firstPageData.Tags...), metaKeywords...))

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
		ZipInfo:       convertZipInfo(zipInfo),
	}

	scraperLogger.Info("Browser scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":    pageURL,
			"images": len(allImages),
			"videos": len(allVideos),
			"domain": usedDomain,
		}})

	return result, nil
}

func navigateAndWait(ctx context.Context, url string) (string, error) {
	allocCtx, cancel := chromedp.NewExecAllocator(ctx,
		chromedp.NoFirstRun,
		chromedp.NoDefaultBrowserCheck,
		chromedp.Headless,
		chromedp.UserAgent(stealth.RandomUA()),
	)
	defer cancel()

	taskCtx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	timeoutCtx, cancel := context.WithTimeout(taskCtx, 30*time.Second)
	defer cancel()

	var html string
	err := chromedp.Run(timeoutCtx,
		chromedp.Navigate(url),
		chromedp.WaitVisible(`article`, chromedp.ByQuery),
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	)
	if err != nil {
		return "", err
	}

	return html, nil
}
