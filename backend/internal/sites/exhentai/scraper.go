package exhentai

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
)

var scraperLogger = infra.NewLogger("ExhentaiProvider")

// ScrapeGalleryHTTP performs HTTP-only gallery scraping with cookie
// authentication, mirroring the TypeScript scrapeGallery flow but
// using goquery instead of browser page evaluation.
func ScrapeGalleryHTTP(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	cookies := GetExhentaiCookies()
	cookieStr := ""
	if cookies != nil {
		cookieStr = cookies.AsCookieString()
	}

	candidateURLs := GetAdaptiveURLs(pageURL)

	var doc *goquery.Document
	var usedURL string

	for _, tryURL := range candidateURLs {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		html, err := fetchHTML(ctx, tryURL, cookieStr)
		if err != nil {
			scraperLogger.Debug("HTTP fetch failed",
				infra.LogContext{Extra: map[string]any{
					"url":   tryURL,
					"error": err.Error(),
				}})
			continue
		}

		if isSadPanda(html) {
			scraperLogger.Warn("Sad panda detected, ExHentai cookies may be invalid",
				infra.LogContext{Extra: map[string]any{
					"url": tryURL,
				}})
			continue
		}

		parsed, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if parsed.Find("#gn").Length() == 0 && parsed.Find("#gdt").Length() == 0 {
			continue
		}

		doc = parsed
		usedURL = tryURL
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all candidate URLs failed to fetch gallery page")
	}

	return buildScrapeResult(ctx, doc, usedURL, cookieStr)
}

// ScrapeGalleryBrowser performs chromedp-based gallery scraping with
// cookie injection, used as a fallback when HTTP mode is blocked.
func ScrapeGalleryBrowser(ctx context.Context, pageURL string) (*sites.GalleryScrapeResult, error) {
	cookies := GetExhentaiCookies()
	cookieStr := ""
	if cookies != nil {
		cookieStr = cookies.AsCookieString()
	}

	candidateURLs := GetAdaptiveURLs(pageURL)

	var doc *goquery.Document
	var usedURL string

	for _, tryURL := range candidateURLs {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		html, err := navigateWithCookies(ctx, tryURL, cookies)
		if err != nil {
			scraperLogger.Debug("Browser navigation failed",
				infra.LogContext{Extra: map[string]any{
					"url":   tryURL,
					"error": err.Error(),
				}})
			continue
		}

		if isSadPanda(html) {
			continue
		}

		parsed, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		if parsed.Find("#gn").Length() == 0 && parsed.Find("#gdt").Length() == 0 {
			continue
		}

		doc = parsed
		usedURL = tryURL
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all candidate URLs failed to fetch gallery page via browser")
	}

	return buildScrapeResult(ctx, doc, usedURL, cookieStr)
}

func buildScrapeResult(ctx context.Context, doc *goquery.Document, pageURL string, cookieStr string) (*sites.GalleryScrapeResult, error) {
	metadata := ExtractExtendedMetadata(doc)
	galleryInfo := ExtractGalleryInfo(doc)

	imagePageLinks := CollectImagePageLinks(ctx, pageURL, galleryInfo.Pages, cookieStr)
	imageURLs := FetchImageURLs(ctx, imagePageLinks, cookieStr)

	allImages := []sites.GalleryImageItem{}
	seenURLs := make(map[string]bool)
	orderIndex := 0

	for i, imgURL := range imageURLs {
		if imgURL == "" || seenURLs[imgURL] {
			continue
		}
		seenURLs[imgURL] = true
		allImages = append(allImages, sites.GalleryImageItem{
			URL:        imgURL,
			PageIndex:  i / ThumbsPerPage,
			OrderIndex: orderIndex,
		})
		orderIndex++
	}

	scrapedDomain := ""
	if idx := strings.Index(pageURL, "://"); idx > 0 {
		endIdx := strings.IndexByte(pageURL[idx+3:], '/')
		if endIdx >= 0 {
			scrapedDomain = pageURL[:idx+3+endIdx]
		} else {
			scrapedDomain = pageURL
		}
	}

	pageCount := 0
	if galleryInfo.Pages > 0 {
		pageCount = (galleryInfo.Pages + ThumbsPerPage - 1) / ThumbsPerPage
	}

	result := &sites.GalleryScrapeResult{
		SourceURL:     pageURL,
		Title:         metadata.Title,
		Protagonist:   firstOrEmpty(metadata.Actors),
		Description:   metadata.Title,
		Category:      galleryInfo.Category,
		Tags:          metadata.Tags,
		CoverURL:      galleryInfo.CoverURL,
		PublishTime:   galleryInfo.Posted,
		Images:        allImages,
		Videos:        []sites.GalleryVideoItem{},
		PageCount:     pageCount,
		ImageCount:    len(allImages),
		VideoCount:    0,
		ScrapedDomain: scrapedDomain,
	}

	scraperLogger.Info("Gallery scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":    pageURL,
			"images": len(allImages),
			"pages":  pageCount,
			"domain": scrapedDomain,
		}})

	return result, nil
}

func navigateWithCookies(ctx context.Context, url string, cookies *ExhentaiCookies) (string, error) {
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
			if cookies == nil {
				return nil
			}
			return setExhentaiCookies(ctx, cookies)
		}),
		chromedp.Navigate(url),
		chromedp.WaitVisible(`#gn, #gdt, body`, chromedp.ByQuery),
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	}

	if err := chromedp.Run(timeoutCtx, actions...); err != nil {
		return "", err
	}

	return html, nil
}

func setExhentaiCookies(ctx context.Context, cookies *ExhentaiCookies) error {
	for _, domain := range SiteDomains {
		parsed, err := url.Parse(domain)
		if err != nil {
			continue
		}
		cookieDomain := "." + parsed.Hostname()
		actions := []*network.SetCookieParams{
			network.SetCookie("ipb_member_id", cookies.IPBMemberID).
				WithDomain(cookieDomain).WithPath("/").WithHTTPOnly(true).WithSecure(true),
			network.SetCookie("ipb_pass_hash", cookies.IPBPassHash).
				WithDomain(cookieDomain).WithPath("/").WithHTTPOnly(true).WithSecure(true),
		}
		if cookies.Igneous != "" {
			actions = append(actions, network.SetCookie("igneous", cookies.Igneous).
				WithDomain(cookieDomain).WithPath("/").WithHTTPOnly(true).WithSecure(true))
		}
		for _, action := range actions {
			if err := action.Do(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func isSadPanda(html string) bool {
	return len(html) < 1000 && !strings.Contains(html, "#gn") && !strings.Contains(html, "#gdt")
}

func firstOrEmpty(items []string) string {
	if len(items) > 0 {
		return items[0]
	}
	return ""
}
