package sjs

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/urlutil"
)

var scraperLogger = infra.NewLogger("SjsProvider")

func ScrapeGalleryHTTP(ctx context.Context, pageURL string, am *sites.SiteAccountManager) (*sites.GalleryScrapeResult, error) {
	cookieStr, accountID := GetAuthCookieString(ctx, am)
	tracker := stealth.GetDomainHealthTracker()
	currentDomains := getCurrentDomains()
	orderedDomains := tracker.GetAllDomainsOrdered(currentDomains)

	var doc *goquery.Document
	var usedDomain string
	var pageHTML string

	for _, domain := range orderedDomains {
		tryURL := urlutil.ReplaceDomain(pageURL, domain, currentDomains)

		html, err := fetchHTMLWithCookies(ctx, tryURL, cookieStr, domain+"/")
		if err != nil {
			scraperLogger.Debug("HTTP fetch failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		parsed, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if parsed.Find("#postlist").Length() == 0 && parsed.Find("#thread_subject").Length() == 0 {
			continue
		}

		doc = parsed
		usedDomain = domain
		pageHTML = html
		tracker.MarkHealthy(domain)
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all domains failed to fetch thread page")
	}

	result, err := buildScrapeResult(ctx, doc, pageHTML, pageURL, usedDomain, cookieStr, accountID, am)
	if err != nil {
		return nil, err
	}

	if accountID > 0 && am != nil {
		_ = am.MarkUsed(ctx, accountID)
	}

	return result, nil
}

// ScrapeGalleryBrowser scrapes a thread with cookie injection over chromedp
// and is used as a fallback when HTTP requests are blocked.
func ScrapeGalleryBrowser(ctx context.Context, pageURL string, am *sites.SiteAccountManager) (*sites.GalleryScrapeResult, error) {
	cookieStr, accountID := GetAuthCookieString(ctx, am)
	tracker := stealth.GetDomainHealthTracker()
	currentDomains := getCurrentDomains()
	orderedDomains := tracker.GetAllDomainsOrdered(currentDomains)

	var doc *goquery.Document
	var usedDomain string
	var pageHTML string

	var cookieData []sites.CookieData
	if am != nil && accountID > 0 {
		cookieData, _ = am.GetAuthCookies(ctx, accountID)
	}

	for _, domain := range orderedDomains {
		tryURL := urlutil.ReplaceDomain(pageURL, domain, currentDomains)

		started := time.Now()
		html, err := navigateWithSjsCookies(ctx, tryURL, domain, cookieData)
		rtt := time.Since(started)
		if err != nil {
			tracker.ReportOutcome(domain, rtt, err)
			scraperLogger.Debug("Browser navigation failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		parsed, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if parsed.Find("#postlist").Length() == 0 && parsed.Find("#thread_subject").Length() == 0 {
			continue
		}

		doc = parsed
		usedDomain = domain
		pageHTML = html
		tracker.MarkHealthy(domain)
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all domains failed to fetch thread page via browser")
	}

	result, err := buildScrapeResult(ctx, doc, pageHTML, pageURL, usedDomain, cookieStr, accountID, am)
	if err != nil {
		return nil, err
	}

	if accountID > 0 && am != nil {
		_ = am.MarkUsed(ctx, accountID)
	}

	return result, nil
}

func buildScrapeResult(ctx context.Context, doc *goquery.Document, pageHTML, pageURL, usedDomain, cookieStr string, accountID int, am *sites.SiteAccountManager) (*sites.GalleryScrapeResult, error) {
	needsPurchase := IsThreadPurchasable(pageHTML)
	downloadLinks := ExtractDownloadLinks(pageHTML)

	if needsPurchase {
		scraperLogger.Info("Thread requires purchase",
			infra.LogContext{Extra: map[string]any{
				"url": pageURL,
			}})
	} else if len(downloadLinks) > 0 {
		scraperLogger.Info("Download links detected",
			infra.LogContext{Extra: map[string]any{
				"count": len(downloadLinks),
			}})
	}

	metadata := ExtractExtendedMetadata(doc)
	firstPageData := ExtractPostContent(doc, 0)
	totalPages := GetThreadTotalPages(doc)

	maxPages := totalPages
	if maxPages > stealth.MaxGalleryPages {
		maxPages = stealth.MaxGalleryPages
	}

	allImages := []sites.GalleryImageItem{}
	allVideos := []sites.GalleryVideoItem{}
	imageUrlSet := make(map[string]bool)
	videoUrlSet := make(map[string]bool)
	orderIndex := 0

	for _, img := range firstPageData.Images {
		fullURL := ResolveURL(img.URL)
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
		fullURL := ResolveURL(videoURL)
		if fullURL != "" && !videoUrlSet[fullURL] {
			videoUrlSet[fullURL] = true
			allVideos = append(allVideos, sites.GalleryVideoItem{URL: fullURL})
		}
	}

	threadID := ExtractThreadID(pageURL)
	forumID := ExtractForumIdOrOne(pageURL)

	for pageNum := 2; pageNum <= maxPages; pageNum++ {
		select {
		case <-ctx.Done():
			break
		default:
		}

		stealth.Sleep(stealth.PageDelayMin, stealth.PageDelayMax)

		pageURLConstructed := usedDomain + "/thread-" + threadID + "-" + fmt.Sprintf("%d", pageNum) + "-" + forumID + ".html"

		pageHTML, err := fetchHTMLWithCookies(ctx, pageURLConstructed, cookieStr, usedDomain+"/")
		if err != nil {
			scraperLogger.Debug("Page fetch failed",
				infra.LogContext{Extra: map[string]any{
					"page":  pageNum,
					"error": err.Error(),
				}})
			continue
		}

		pageDoc, err := goquery.NewDocumentFromReader(strings.NewReader(pageHTML))
		if err != nil {
			continue
		}

		pageData := ExtractPostContent(pageDoc, pageNum-1)

		for _, img := range pageData.Images {
			fullURL := ResolveURL(img.URL)
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
			fullURL := ResolveURL(videoURL)
			if fullURL != "" && !videoUrlSet[fullURL] {
				videoUrlSet[fullURL] = true
				allVideos = append(allVideos, sites.GalleryVideoItem{URL: fullURL})
			}
		}

		scraperLogger.Debug("Page scraped",
			infra.LogContext{Extra: map[string]any{
				"page":   pageNum,
				"images": len(allImages),
			}})
	}

	scrapedDomain := usedDomain
	if scrapedDomain == "" {
		scrapedDomain = PrimaryDomain
	}

	result := &sites.GalleryScrapeResult{
		SourceURL:     pageURL,
		Title:         metadata.Title,
		Protagonist:   firstOrEmpty(metadata.Actors),
		Description:   metadata.Title,
		Category:      firstOrEmpty(metadata.Categories),
		Tags:          metadata.Tags,
		CoverURL:      ResolveURL(firstPageData.CoverURL),
		PublishTime:   firstPageData.PublishTime,
		Images:        allImages,
		Videos:        allVideos,
		PageCount:     maxPages,
		ImageCount:    len(allImages),
		VideoCount:    len(allVideos),
		ScrapedDomain: scrapedDomain,
		NeedsPurchase: needsPurchase,
		DownloadLinks: downloadLinks,
	}

	scraperLogger.Info("Gallery scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":    pageURL,
			"images": len(allImages),
			"videos": len(allVideos),
			"pages":  maxPages,
			"domain": scrapedDomain,
			"paid":   needsPurchase,
		}})

	return result, nil
}

func navigateWithSjsCookies(ctx context.Context, targetURL, domain string, cookies []sites.CookieData) (string, error) {
	allocCtx, cancel := chromedp.NewExecAllocator(ctx,
		chromedp.NoFirstRun,
		chromedp.NoDefaultBrowserCheck,
		chromedp.Headless,
		chromedp.UserAgent(stealth.RandomUA()),
	)
	defer cancel()

	taskCtx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	timeoutCtx, cancel := context.WithTimeout(taskCtx, 40*time.Second)
	defer cancel()

	var html string

	actions := []chromedp.Action{
		chromedp.ActionFunc(func(ctx context.Context) error {
			parsed, err := url.Parse(domain)
			if err != nil {
				return nil
			}
			hostname := "." + parsed.Hostname()
			for _, c := range cookies {
				action := network.SetCookie(c.Name, c.Value).
					WithDomain(hostname).WithPath(c.Path)
				if err := action.Do(ctx); err != nil {
					continue
				}
			}
			return nil
		}),
		chromedp.Navigate(targetURL),
		chromedp.WaitVisible(`#postlist, #thread_subject, body`, chromedp.ByQuery),
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	}

	if err := chromedp.Run(timeoutCtx, actions...); err != nil {
		return "", err
	}

	return html, nil
}

func fetchHTMLWithCookies(ctx context.Context, reqURL, cookieStr, referer string) (string, error) {
	jar := NewCookieJar()
	if cookieStr != "" {
		for _, part := range strings.Split(cookieStr, "; ") {
			if eq := strings.Index(part, "="); eq > 0 {
				jar.cookies[part[:eq]] = part[eq+1:]
			}
		}
	}

	resp, err := httpRequest(ctx, "GET", reqURL, jar, referer, nil)
	if err != nil {
		return "", err
	}

	return resp.Body, nil
}

func ExtractForumIdOrOne(rawURL string) string {
	fid := ExtractForumID(rawURL)
	if fid == "" {
		return "1"
	}
	return fid
}

func firstOrEmpty(items []string) string {
	if len(items) > 0 {
		return items[0]
	}
	return ""
}
