package xsnvshen

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chromedp/chromedp"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/xutil"
)

var scraperLogger = infra.NewLogger("XsnvshenProvider")

// ScrapeDeps defines the callbacks the scrapers need from the provider,
// decoupling scraping logic from provider-specific concerns.
type ScrapeDeps interface {
	ResolveURL(rawURL, domain string) string
	CleanTitle(rawTitle string) string
	ExtractProtagonist(title string, tags []string) string
	ExtractDescription(title, protagonist string) string
	CheckBlockedAsync(ctx context.Context, title, category, protagonist string) (sites.BlockCheckResult, error)
}

// verifiedDomains caches domains that have passed age verification,
// avoiding redundant POST requests on subsequent fetches.
var verifiedDomains sync.Map

// performAgeVerification submits the anti-addiction POST form to obtain
// the session cookie required for accessing real gallery content.
func performAgeVerification(ctx context.Context, domain string) bool {
	if _, ok := verifiedDomains.Load(domain); ok {
		return true
	}

	verifyURL := domain + "/album/45437"
	formData := url.Values{}
	formData.Set(AgeVerifyField, AgeVerifyValue)

	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, domain)
	headers.Set("Content-Type", "application/x-www-form-urlencoded")

	req, err := http.NewRequestWithContext(ctx, "POST", verifyURL, strings.NewReader(formData.Encode()))
	if err != nil {
		return false
	}
	req.Header = headers

	client := stealth.NewStealthClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		scraperLogger.Warn("Age verification request failed",
			infra.LogContext{Extra: map[string]any{
				"domain": domain,
				"error":  err.Error(),
			}})
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		scraperLogger.Warn("Age verification returned non-200",
			infra.LogContext{Extra: map[string]any{
				"domain": domain,
				"status": resp.StatusCode,
			}})
		return false
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(body)))
	if err != nil {
		return false
	}

	if IsAgeVerificationPage(doc) || Is404Page(doc) {
		return false
	}

	verifiedDomains.Store(domain, true)
	scraperLogger.Info("Age verification passed",
		infra.LogContext{Extra: map[string]any{
			"domain": domain,
		}})
	return true
}

type albumFetchResult struct {
	doc        *goquery.Document
	usedDomain string
	usedURL    string
}

// fetchAlbumHtml attempts to fetch and parse an album page across
// candidate domains, performing age verification when the interstitial
// is encountered and marking rate-limited domains for cooldown.
func fetchAlbumHtml(ctx context.Context, pageURL, albumID string) (*albumFetchResult, error) {
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(SiteDomains)

	urlDomain := ExtractDomainFromUrl(pageURL)
	if urlDomain != "" {
		for i, d := range orderedDomains {
			if d == urlDomain {
				orderedDomains = append(orderedDomains[:i], orderedDomains[i+1:]...)
				orderedDomains = append([]string{urlDomain}, orderedDomains...)
				break
			}
		}
	}

	for _, domain := range orderedDomains {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		tryURL := pageURL
		if albumID != "" {
			tryURL = domain + "/album/" + albumID
		}

		html, statusCode, err := fetchHTMLRaw(ctx, tryURL, domain)
		if err != nil {
			scraperLogger.Debug("HTTP fetch failed",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"error":  err.Error(),
				}})
			continue
		}

		if statusCode == 403 || statusCode == 429 {
			tracker.MarkRateLimited(domain)
			continue
		}
		if statusCode == 404 {
			continue
		}

		doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
		if err != nil {
			continue
		}

		wafResult := stealth.DetectWaf(statusCode, html, doc)
		if wafResult.Blocked {
			tracker.MarkRateLimited(domain)
			scraperLogger.Warn("WAF block detected",
				infra.LogContext{Extra: map[string]any{
					"domain": domain,
					"detail": wafResult.Detail,
				}})
			continue
		}

		if IsAgeVerificationPage(doc) {
			if !performAgeVerification(ctx, domain) {
				continue
			}

			html2, statusCode2, err := fetchHTMLRaw(ctx, tryURL, domain)
			if err != nil || statusCode2 != 200 {
				continue
			}

			doc, err = goquery.NewDocumentFromReader(strings.NewReader(html2))
			if err != nil {
				continue
			}

			if IsAgeVerificationPage(doc) {
				continue
			}
		}

		h1Text := strings.TrimSpace(doc.Find("h1").First().Text())
		titleText := strings.TrimSpace(doc.Find("title").First().Text())
		hasImages := doc.Find("img.origin_image.lazy").Length() > 0
		if h1Text == "" && titleText == "" && !hasImages {
			continue
		}

		tracker.MarkHealthy(domain)
		return &albumFetchResult{
			doc:        doc,
			usedDomain: domain,
			usedURL:    tryURL,
		}, nil
	}

	return nil, fmt.Errorf("all HTTP domains failed to fetch page")
}

// ScrapeGalleryHTTP performs HTTP-only gallery scraping with anti-addiction
// verification and multi-domain failover, mirroring the TypeScript
// scrape-gallery-http implementation.
func ScrapeGalleryHTTP(ctx context.Context, pageURL string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	albumID := ExtractAlbumID(pageURL)

	fetchResult, err := fetchAlbumHtml(ctx, pageURL, albumID)
	if err != nil {
		return nil, err
	}

	return buildScrapeResult(ctx, fetchResult.doc, pageURL, fetchResult.usedDomain, deps)
}

// ScrapeGalleryBrowser performs chromedp-based gallery scraping with
// in-page age verification, used as a fallback when HTTP mode is blocked.
func ScrapeGalleryBrowser(ctx context.Context, pageURL string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	albumID := ExtractAlbumID(pageURL)
	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(SiteDomains)

	urlDomain := ExtractDomainFromUrl(pageURL)
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
		if albumID != "" {
			tryURL = domain + "/album/" + albumID
		}

		html, err := navigateWithAgeVerification(ctx, tryURL)
		if err != nil {
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

		if IsAgeVerificationPage(parsed) {
			continue
		}

		h1Text := strings.TrimSpace(parsed.Find("h1").First().Text())
		titleText := strings.TrimSpace(parsed.Find("title").First().Text())
		hasImages := parsed.Find("img.origin_image.lazy").Length() > 0
		if h1Text == "" && titleText == "" && !hasImages {
			continue
		}

		doc = parsed
		usedDomain = domain
		tracker.MarkHealthy(domain)
		break
	}

	if doc == nil {
		return nil, fmt.Errorf("all browser domains failed to fetch page")
	}

	return buildScrapeResult(ctx, doc, pageURL, usedDomain, deps)
}

func buildScrapeResult(ctx context.Context, doc *goquery.Document, pageURL, usedDomain string, deps ScrapeDeps) (*sites.GalleryScrapeResult, error) {
	firstPageData := ParseGalleryPageHtml(doc, 0)

	allImages := []sites.GalleryImageItem{}
	imageURLSet := make(map[string]bool)
	orderIndex := 0

	for _, img := range firstPageData.Images {
		fullURL := deps.ResolveURL(img.URL, usedDomain)
		if fullURL != "" && !imageURLSet[fullURL] {
			imageURLSet[fullURL] = true
			allImages = append(allImages, sites.GalleryImageItem{
				URL:        fullURL,
				PageIndex:  img.PageIndex,
				OrderIndex: orderIndex,
			})
			orderIndex++
		}
	}

	title := deps.CleanTitle(firstPageData.H1Title)
	if title == "" {
		title = deps.CleanTitle(firstPageData.RawTitle)
	}

	// Prefer protagonist from meta description (xsnvshen-specific extraction)
	protagonist := firstPageData.Protagonist
	if protagonist == "" {
		protagonist = deps.ExtractProtagonist(title, firstPageData.Tags)
	}
	description := deps.ExtractDescription(title, protagonist)

	blockCheck, err := deps.CheckBlockedAsync(ctx, title, firstPageData.Category, protagonist)
	if err != nil {
		return nil, fmt.Errorf("check content blocked: %w", err)
	}
	if blockCheck.Blocked {
		return nil, fmt.Errorf("content blocked: %s", blockCheck.Reason)
	}

	metaKeywordsStr := doc.Find(`meta[name="keywords"]`).AttrOr("content", "")
	var metaKeywords []string
	for _, kw := range strings.Split(metaKeywordsStr, ",") {
		kw = strings.TrimSpace(kw)
		if kw != "" && len(kw) < 50 {
			metaKeywords = append(metaKeywords, kw)
		}
	}

	allTags := xutil.UniqueStrings(append(append([]string{}, firstPageData.Tags...), metaKeywords...), true)

	scrapedDomain := usedDomain
	if scrapedDomain == "" {
		if idx := strings.Index(pageURL, "://"); idx > 0 {
			endIdx := strings.IndexByte(pageURL[idx+3:], '/')
			if endIdx >= 0 {
				scrapedDomain = pageURL[:idx+3+endIdx]
			} else {
				scrapedDomain = pageURL
			}
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
		PageCount:     1,
		ImageCount:    len(allImages),
		VideoCount:    0,
		ScrapedDomain: scrapedDomain,
	}

	scraperLogger.Info("Gallery scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":    pageURL,
			"images": len(allImages),
			"domain": scrapedDomain,
		}})

	return result, nil
}

// navigateWithAgeVerification navigates to the URL in a headless browser,
// detects the anti-addiction interstitial, and submits the verification
// form via in-page fetch to obtain the session cookie.
func navigateWithAgeVerification(ctx context.Context, targetURL string) (string, error) {
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
	err := chromedp.Run(timeoutCtx,
		chromedp.Navigate(targetURL),
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	)
	if err != nil {
		return "", err
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return html, nil
	}

	if !IsAgeVerificationPage(doc) {
		return html, nil
	}

	var verified bool
	verifyJS := fmt.Sprintf(`
		async function verify() {
			try {
				const formData = new URLSearchParams();
				formData.append('%s', '%s');
				const resp = await fetch(window.location.href, {
					method: 'POST',
					body: formData,
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					redirect: 'follow',
					credentials: 'include',
				});
				if (resp.ok) {
					const html = await resp.text();
					document.open();
					document.write(html);
					document.close();
					return true;
				}
				return false;
			} catch { return false; }
		}
		verify();
	`, AgeVerifyField, AgeVerifyValue)

	err = chromedp.Run(timeoutCtx,
		chromedp.Evaluate(verifyJS, &verified),
	)
	if err != nil {
		return "", fmt.Errorf("age verification failed: %w", err)
	}

	if !verified {
		return "", fmt.Errorf("age verification returned false")
	}

	stealth.Sleep(500, 1000)

	err = chromedp.Run(timeoutCtx,
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	)
	if err != nil {
		return "", err
	}

	return html, nil
}

func fetchHTMLRaw(ctx context.Context, targetURL, domain string) (string, int, error) {
	profile := stealth.RandomProfile()
	headers := stealth.BuildStealthHeaders(profile, domain)

	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header = headers

	client := stealth.NewStealthClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp.StatusCode, err
	}

	return string(body), resp.StatusCode, nil
}

