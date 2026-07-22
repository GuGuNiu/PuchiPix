package universal

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var scraperLogger = infra.NewLogger("UniversalProvider")

// pageMetadata holds the extracted video page metadata before
// transformation into a ScrapeResult.
type pageMetadata struct {
	Title  string
	Tags   []string
	Actors []string
}

// ScrapePage navigates to the given URL in a headless browser, intercepts
// network requests for M3U8 URLs, scans page JavaScript and DOM for
// embedded stream URLs, and returns the best candidate with metadata.
func ScrapePage(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
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

	var capturedMu sync.Mutex
	var capturedM3U8 []string

	chromedp.ListenTarget(timeoutCtx, func(ev interface{}) {
		if req, ok := ev.(*network.EventRequestWillBeSent); ok {
			url := req.Request.URL
			if m3u8ExtPattern.MatchString(url) {
				if !isExcluded(url) {
					capturedMu.Lock()
					capturedM3U8 = append(capturedM3U8, url)
					capturedMu.Unlock()
				}
			}
		}
	})

	if err := chromedp.Run(timeoutCtx,
		network.Enable(),
		chromedp.Navigate(pageURL),
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
	); err != nil {
		scraperLogger.Warn("Navigation failed",
			infra.LogContext{Extra: map[string]any{
				"url":   pageURL,
				"error": err.Error(),
			}})
		return nil, fmt.Errorf("navigation failed: %w", err)
	}

	meta := extractMetadata(timeoutCtx)

	clickPlayButtons(timeoutCtx)

	time.Sleep(1500 * time.Millisecond)

	jsM3U8 := scanJsForM3U8(timeoutCtx)
	capturedMu.Lock()
	capturedM3U8 = append(capturedM3U8, jsM3U8...)
	capturedMu.Unlock()

	iframeM3U8 := scanIframesForM3U8(timeoutCtx)
	capturedMu.Lock()
	capturedM3U8 = append(capturedM3U8, iframeM3U8...)
	capturedMu.Unlock()

	videoM3U8 := scanVideoElementsForM3U8(timeoutCtx)
	capturedMu.Lock()
	capturedM3U8 = append(capturedM3U8, videoM3U8...)
	capturedMu.Unlock()

	capturedMu.Lock()
	allURLs := make([]string, len(capturedM3U8))
	copy(allURLs, capturedM3U8)
	capturedMu.Unlock()

	filtered := filterM3U8(allURLs)

	m3u8URL := SelectBestM3U8(filtered)

	var candidates []sites.M3U8Candidate
	if len(filtered) > 1 {
		candidates = make([]sites.M3U8Candidate, 0, len(filtered))
		for _, u := range filtered {
			candidates = append(candidates, sites.M3U8Candidate{
				URL:   u,
				Title: GuessM3U8Title(u, meta.Title),
			})
		}
	}

	scraperLogger.Info("M3U8 sniffing completed",
		infra.LogContext{Extra: map[string]any{
			"url":       pageURL,
			"captured":  len(allURLs),
			"filtered":  len(filtered),
			"selected":  m3u8URL != "",
		}})

	result := &sites.ScrapeResult{
		M3U8URL:        m3u8URL,
		M3U8Candidates: candidates,
		Title:          meta.Title,
		PageURL:        pageURL,
		Tags:           meta.Tags,
		Actors:         meta.Actors,
		Categories:     []string{},
		Director:       "",
	}

	return result, nil
}

func isExcluded(url string) bool {
	lower := strings.ToLower(url)
	for _, p := range M3U8ExcludePatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func filterM3U8(urls []string) []string {
	deduped := DeduplicateM3U8(urls)
	var result []string
	for _, u := range deduped {
		if !isExcluded(u) {
			result = append(result, u)
		}
	}
	return result
}

func extractMetadata(ctx context.Context) pageMetadata {
	var rawTitle string
	_ = chromedp.Run(ctx, chromedp.Evaluate(titleExtractorJS(), &rawTitle))
	title := CleanTitle(rawTitle)

	var tags []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(tagsExtractorJS(), &tags))

	var actors []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(actorsExtractorJS(), &actors))

	return pageMetadata{
		Title:  title,
		Tags:   uniqueStrings(tags),
		Actors: uniqueStrings(actors),
	}
}

func clickPlayButtons(ctx context.Context) {
	for _, sel := range PlayButtonSelectors {
		js := fmt.Sprintf(`
			(function() {
				const el = document.querySelector(%q);
				if (el) {
					el.click();
					return true;
				}
				return false;
			})()
		`, sel)
		var clicked bool
		if err := chromedp.Run(ctx, chromedp.Evaluate(js, &clicked)); err == nil && clicked {
			time.Sleep(1000 * time.Millisecond)
			return
		}
	}
}

func scanJsForM3U8(ctx context.Context) []string {
	var urls []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(jsM3U8ScannerJS(), &urls))
	return urls
}

func scanIframesForM3U8(ctx context.Context) []string {
	var urls []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(iframeM3U8ScannerJS(), &urls))
	return urls
}

func scanVideoElementsForM3U8(ctx context.Context) []string {
	var urls []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(videoM3U8ScannerJS(), &urls))
	return urls
}

func titleExtractorJS() string {
	return `
		(function() {
			let title = document.title || '';
			const ogTitle = document.querySelector('meta[property="og:title"]');
			if (ogTitle) {
				const content = ogTitle.getAttribute('content') || '';
				if (content.length > title.length) title = content;
			}
			const metaTitle = document.querySelector('meta[name="title"]');
			if (metaTitle && !title) {
				const content = metaTitle.getAttribute('content') || '';
				if (content) title = content;
			}
			return title.trim();
		})()
	`
}

func tagsExtractorJS() string {
	return `
		(function() {
			const tagList = [];
			const metaKeywords = document.querySelector('meta[name="keywords"]');
			if (metaKeywords) {
				const content = metaKeywords.getAttribute('content') || '';
				if (content) {
					content.split(/[,;]/).forEach(t => {
						t = t.trim();
						if (t && !t.includes(' - ') && t.length < 50) tagList.push(t);
					});
				}
			}
			document.querySelectorAll('meta[property*="tag"], meta[name*="tag"]').forEach(el => {
				const content = el.getAttribute('content') || '';
				if (content) tagList.push(content.trim());
			});
			document.querySelectorAll('.category a, .tag a, .tags a, [class*="tag"] a').forEach(el => {
				const text = (el.textContent || '').trim();
				if (text && text.length < 50) tagList.push(text);
			});
			return [...new Set(tagList)];
		})()
	`
}

func actorsExtractorJS() string {
	return `
		(function() {
			const actorList = [];
			const selectors = [
				'.actor a', '.actors a', '.star a', '.stars a',
				'.cast a', '.performer a', '.model a',
				'[class*="actor"] a', '[class*="star"] a',
				'[class*="performer"] a', '[class*="model"] a',
				'.avatar-name', '.actor-name', '.star-name',
				'[class*="kv"] a', '.celebrity a',
				'.video-actor', '.media-star'
			];
			selectors.forEach(sel => {
				document.querySelectorAll(sel).forEach(el => {
					const text = (el.textContent || '').trim();
					if (text && text.length < 50) actorList.push(text);
				});
			});
			return [...new Set(actorList)];
		})()
	`
}

func jsM3U8ScannerJS() string {
	return `
		(function() {
			const urls = [];
			const tryAddUrl = (rawUrl) => {
				const url = (rawUrl || '').trim();
				if (!url) return;
				if (url.includes('.m3u8') || url.includes('.m3u')) {
					urls.push(url);
				}
				try {
					const decoded = decodeURIComponent(url);
					if (decoded !== url && (decoded.includes('.m3u8') || decoded.includes('.m3u'))) {
						urls.push(decoded);
					}
				} catch {}
				try {
					const decoded = atob(url);
					if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
						urls.push(decoded);
					}
				} catch {}
			};
			try {
				const playerData = window.player_aaaa;
				if (playerData && typeof playerData.url === 'string') {
					tryAddUrl(playerData.url);
				}
			} catch {}
			if (urls.length === 0) {
				try {
					const scripts = document.querySelectorAll('script');
					for (const script of scripts) {
						const content = script.textContent || script.innerHTML || '';
						const match = content.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
						if (match) {
							try {
								const playerData = JSON.parse(match[1]);
								if (playerData.url && typeof playerData.url === 'string') {
									tryAddUrl(playerData.url);
								}
							} catch {}
							break;
						}
					}
				} catch {}
			}
			const scripts = document.querySelectorAll('script');
			scripts.forEach(script => {
				const content = script.textContent || script.innerHTML || '';
				const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
				if (matches) {
					urls.push(...matches);
				}
			});
			return urls;
		})()
	`
}

func iframeM3U8ScannerJS() string {
	return `
		(function() {
			const urls = [];
			try {
				const frames = document.querySelectorAll('iframe');
				frames.forEach(frame => {
					try {
						const doc = frame.contentDocument || frame.contentWindow.document;
						if (!doc) return;
						try {
							const playerData = doc.defaultView && doc.defaultView.player_aaaa;
							if (playerData && typeof playerData.url === 'string') {
								const url = playerData.url.trim();
								if (url.includes('.m3u8') || url.includes('.m3u')) {
									urls.push(url);
								}
								try {
									const decoded = decodeURIComponent(url);
									if (decoded !== url && (decoded.includes('.m3u8') || decoded.includes('.m3u'))) {
										urls.push(decoded);
									}
								} catch {}
								try {
									const decoded = atob(url);
									if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
										urls.push(decoded);
									}
								} catch {}
							}
						} catch {}
						doc.querySelectorAll('script').forEach(script => {
							const content = script.textContent || script.innerHTML || '';
							const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
							if (matches) urls.push(...matches);
						});
					} catch {}
				});
			} catch {}
			return urls;
		})()
	`
}

func videoM3U8ScannerJS() string {
	return `
		(function() {
			const urls = [];
			document.querySelectorAll('video source[src*=".m3u8"], video[src*=".m3u8"]').forEach(el => {
				const src = el.getAttribute('src') || '';
				if (src) urls.push(src);
			});
			return urls;
		})()
	`
}

func uniqueStrings(input []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, s := range input {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

