package universal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
	"backend/internal/urlutil"
	"backend/internal/xutil"
)

var scraperLogger = infra.NewLogger("UniversalProvider")

// pageMetadata holds the extracted video page metadata before
// transformation into a ScrapeResult.
type pageMetadata struct {
	Title      string
	Tags       []string
	Actors     []string
	Categories []string
	Director   string
}

// ScrapePage navigates to the given URL in a headless browser, intercepts
// network requests for M3U8 URLs, scans page JavaScript and DOM for
// embedded stream URLs, and returns the best candidate with metadata.
func ScrapePage(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	return scrapeChrome(ctx, pageURL, false)
}

// ScrapePageHeadful navigates in a visible (non-headless) browser, used
// as a last-resort fallback when headless Chrome is blocked by CloudFlare
// or other anti-bot systems that detect headless mode via fingerprinting.
func ScrapePageHeadful(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	return scrapeChrome(ctx, pageURL, true)
}

// scrapeChrome is the shared implementation for both headless and headful
// Chromedp scraping. When headful=true, the browser window is visible and
// extra flags suppress automation markers.
func scrapeChrome(ctx context.Context, pageURL string, headful bool) (*sites.ScrapeResult, error) {
	opts := []chromedp.ExecAllocatorOption{
		chromedp.NoFirstRun,
		chromedp.NoDefaultBrowserCheck,
		chromedp.UserAgent(stealth.RandomUA()),
	}
	if headful {
		opts = append(opts,
			chromedp.Flag("disable-blink-features", "AutomationControlled"),
			chromedp.WindowSize(1280, 720),
		)
	} else {
		opts = append(opts, chromedp.Headless)
	}
	allocCtx, cancel := chromedp.NewExecAllocator(ctx, opts...)
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
		Categories:     meta.Categories,
		Director:       meta.Director,
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

	var categories []string
	_ = chromedp.Run(ctx, chromedp.Evaluate(categoriesExtractorJS(), &categories))

	var director string
	_ = chromedp.Run(ctx, chromedp.Evaluate(directorExtractorJS(), &director))

	actors = xutil.UniqueStrings(actors, true)

	return pageMetadata{
		Title:      title,
		Tags:       stripActorsFromTags(xutil.UniqueStrings(tags, true), actors),
		Actors:     actors,
		Categories: xutil.UniqueStrings(categories, true),
		Director:   director,
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
			// Primary: Kanav/MacCMS player_aaaa.vod_data.vod_name
			try {
				const scripts = document.querySelectorAll('script');
				for (const script of scripts) {
					const content = script.textContent || '';
					const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
					if (match) {
						try {
							const pd = JSON.parse(match[1]);
							if (pd.vod_data && pd.vod_data.vod_name) {
								return pd.vod_data.vod_name.trim();
							}
						} catch {}
						break;
					}
				}
			} catch {}
			// Fallback: document.title / og:title / meta[name="title"]
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
			// Kanav/MacCMS: .video-countext-tags links (excluding series entries)
			document.querySelectorAll('.video-countext-tags a').forEach(function(el) {
				const text = (el.textContent || '').trim();
				if (text && text.length < 50) tagList.push(text);
			});
			// Generic: meta keywords
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

// actorsExtractorJS extracts actor/model names from the page.
// Primary source: player_aaaa.vod_data.vod_actor (Kanav/MacCMS).
// Fallback: generic DOM CSS selectors (.actor a, .model a, etc.).
func actorsExtractorJS() string {
	return `
		(function() {
			const actorList = [];
			// Primary: Kanav/MacCMS player_aaaa.vod_data.vod_actor
			try {
				const scripts = document.querySelectorAll('script');
				for (const script of scripts) {
					const content = script.textContent || '';
					const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
					if (match) {
						try {
							const pd = JSON.parse(match[1]);
							if (pd.vod_data && pd.vod_data.vod_actor) {
								pd.vod_data.vod_actor.split(/[,，、\/\|&]/).forEach(function(a) {
									a = a.trim();
									if (a) actorList.push(a);
								});
							}
						} catch {}
						break;
					}
				}
			} catch {}
			// Fallback: generic DOM selectors
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
					// MacCMS double-encoding: base64(url_encode(url))
					// atob gives URL-encoded string, need decodeURIComponent too
					try {
						const doubleDecoded = decodeURIComponent(decoded);
						if (doubleDecoded !== decoded && (doubleDecoded.includes('.m3u8') || doubleDecoded.includes('.m3u'))) {
							urls.push(doubleDecoded);
						}
					} catch {}
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
									// MacCMS double-encoding: base64(url_encode(url))
									try {
										const doubleDecoded = decodeURIComponent(decoded);
										if (doubleDecoded !== decoded && (doubleDecoded.includes('.m3u8') || doubleDecoded.includes('.m3u'))) {
											urls.push(doubleDecoded);
										}
									} catch {}
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


// categoriesExtractorJS extracts video categories from the page.
// Primary source: player_aaaa.vod_data.vod_class (Kanav/MacCMS).
// Fallback: .video-countext-categories a[rel="tag"] selectors.
func categoriesExtractorJS() string {
	return `
		(function() {
			const cats = [];
			// Primary: Kanav/MacCMS player_aaaa.vod_data
			try {
				const scripts = document.querySelectorAll('script');
				for (const script of scripts) {
					const content = script.textContent || '';
					const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
					if (match) {
						try {
							const pd = JSON.parse(match[1]);
							if (pd.vod_data && pd.vod_data.vod_class) {
								const cls = pd.vod_data.vod_class.trim();
								if (cls) cls.split(/[,，、\s]+/).forEach(function(c) {
									c = c.trim();
									if (c) cats.push(c);
								});
							}
						} catch {}
						break;
					}
				}
			} catch {}
			// Fallback: DOM selectors
			var container = document.querySelector('.video-countext-categories');
			if (container) {
				container.querySelectorAll('a[rel="tag"]').forEach(function(el) {
					var text = (el.textContent || '').trim();
					if (text && text.indexOf('上映') === -1) cats.push(text);
				});
			}
			// Generic: category links
			if (cats.length === 0) {
				document.querySelectorAll('.categories a, [class*="category"] a').forEach(function(el) {
					var text = (el.textContent || '').trim();
					if (text && text.length < 30) cats.push(text);
				});
			}
			return [...new Set(cats)];
		})()
	`
}

// directorExtractorJS extracts the director name from the page.
// Primary source: player_aaaa.vod_data.vod_director (Kanav/MacCMS).
// Fallback: meta[itemprop="director"] content attribute.
func directorExtractorJS() string {
	return `
		(function() {
			// Primary: Kanav/MacCMS player_aaaa.vod_data
			try {
				const scripts = document.querySelectorAll('script');
				for (const script of scripts) {
					const content = script.textContent || '';
					const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
					if (match) {
						try {
							const pd = JSON.parse(match[1]);
							if (pd.vod_data && pd.vod_data.vod_director) {
								return pd.vod_data.vod_director.trim();
							}
						} catch {}
						break;
					}
				}
			} catch {}
			// Fallback: schema.org director itemprop
			var meta = document.querySelector('meta[itemprop="director"]');
			if (meta) {
				var content = meta.getAttribute('content') || '';
				if (content) return content.trim();
			}
			// Fallback: labeled director element
			var els = document.querySelectorAll('.director span, [class*="director"] span');
			for (var i = 0; i < els.length; i++) {
				var text = (els[i].textContent || '').trim();
				if (text && text.length < 50) return text;
			}
			return '';
		})()
	`
}

// playerDataPattern extracts the player_aaaa JSON object from inline scripts.
var playerDataPattern = regexp.MustCompile(`var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});`)

// ScrapePageHTTP fetches the page via HTTP GET (no browser), extracts M3U8
// URLs from player_aaaa JSON, <video> source tags, and inline JavaScript
// patterns, then parses HTML metadata via goquery. This is the HTTP-first
// strategy for video sites that serve M3U8 URLs in static HTML.
func ScrapePageHTTP(ctx context.Context, pageURL string) (*sites.ScrapeResult, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 304 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	body := string(bodyBytes)

	doc, docErr := goquery.NewDocumentFromReader(strings.NewReader(body))
	if docErr != nil {
		scraperLogger.Warn("goquery parse failed, continuing with regex-only",
			infra.LogContext{Extra: map[string]any{"url": pageURL, "error": docErr.Error()}})
	}

	// Extract M3U8 URLs.
	var m3u8URLs []string

	// 1. player_aaaa JSON (Kanav/MacCMS).
	// MacCMS encodes the M3U8 URL as base64(url_encode(actual_url)).
	// We decode it here so downstream code gets a real HTTP URL.
	for _, m := range playerDataPattern.FindAllStringSubmatch(body, 1) {
		if len(m) >= 2 {
			if urlMatch := regexp.MustCompile(`"url"\s*:\s*"([^"]+)"`).FindStringSubmatch(m[1]); len(urlMatch) >= 2 {
				m3u8URLs = append(m3u8URLs, DecodeMacCMSURL(urlMatch[1]))
			}
		}
	}

	// 2. <video> source tags.
	if doc != nil {
		doc.Find("video source[src*='.m3u8'], video source[src*='.m3u'], video[src*='.m3u8']").Each(func(_ int, s *goquery.Selection) {
			if src, ok := s.Attr("src"); ok && src != "" {
				m3u8URLs = append(m3u8URLs, src)
			}
		})
	}
	for _, m := range regexp.MustCompile(`<video[^>]+src=["']([^"']*\.m3u8[^"']*)["']`).FindAllStringSubmatch(body, -1) {
		if len(m) >= 2 {
			m3u8URLs = append(m3u8URLs, m[1])
		}
	}

	// 3. Generic M3U8 URL patterns in page text.
	for _, m := range regexp.MustCompile(`https?://[^\s"'<>]+\.m3u8[^\s"'<>]*`).FindAllString(body, -1) {
		m3u8URLs = append(m3u8URLs, m)
	}

	filtered := filterM3U8(m3u8URLs)
	m3u8URL := SelectBestM3U8(filtered)

	// Extract metadata from HTML.
	title := ""
	tags := []string{}
	actors := []string{}
	categories := []string{}
	director := ""

	if doc != nil {
		if og, ok := doc.Find(`meta[property="og:title"]`).Attr("content"); ok && og != "" {
			title = og
		} else {
			title = strings.TrimSpace(doc.Find("title").First().Text())
		}
		title = CleanTitle(title)

		doc.Find(".video-countext-tags a").Each(func(_ int, s *goquery.Selection) {
			if text := strings.TrimSpace(s.Text()); text != "" && len(text) < 50 {
				tags = append(tags, text)
			}
		})

		doc.Find(".video-countext-categories a[rel=\"tag\"]").Each(func(_ int, s *goquery.Selection) {
			if text := strings.TrimSpace(s.Text()); text != "" && !strings.Contains(text, "上映") {
				categories = append(categories, text)
			}
		})
	}

	// Actors/Director from player_aaaa JSON in raw HTML.
	// Use json.Unmarshal instead of regex to properly decode Unicode
	// escape sequences (\uXXXX) in MacCMS JSON values. The previous
	// regex approach captured literal \uXXXX text without decoding,
	// causing double-escaping when the value was later re-serialized.
	for _, m := range playerDataPattern.FindAllStringSubmatch(body, 1) {
		if len(m) >= 2 {
			raw := m[1]
			var pd struct {
				VodData struct {
					Actor    string `json:"vod_actor"`
					Director string `json:"vod_director"`
					Name     string `json:"vod_name"`
					Tag      string `json:"vod_tag"`
					Tags     string `json:"vod_tags"`
				} `json:"vod_data"`
			}
			if err := json.Unmarshal([]byte(raw), &pd); err == nil {
				// json.Unmarshal properly decodes \uXXXX sequences.
				for _, a := range strings.Split(pd.VodData.Actor, ",") {
					if a = strings.TrimSpace(a); a != "" {
						actors = append(actors, a)
					}
				}
				if director == "" {
					director = strings.TrimSpace(pd.VodData.Director)
				}
				// Use vod_name as title fallback if title is empty.
				if title == "" && pd.VodData.Name != "" {
					title = CleanTitle(strings.TrimSpace(pd.VodData.Name))
				}
				// MacCMS keeps the page's tag list in vod_tag(s).
				// When the DOM tag section is missing or JS-rendered
				// (invisible to the plain HTTP fetch), this is the
				// only remaining source for page tags. vod_class is
				// deliberately NOT used — on MacCMS it is the category
				// name (already captured via .video-countext-categories)
				// and would pollute the tag list with category names.
				if len(tags) == 0 {
					for _, field := range []string{pd.VodData.Tag, pd.VodData.Tags} {
						for _, t := range strings.Split(field, ",") {
							if t = strings.TrimSpace(t); t != "" && len(t) < 50 {
								tags = append(tags, t)
							}
						}
					}
				}
			} else {
				// Fallback: regex extraction if JSON parsing fails.
				// Wrap the captured value in quotes and json.Unmarshal
				// it as a JSON string to properly decode \uXXXX escapes.
				if actorMatch := regexp.MustCompile(`"vod_actor"\s*:\s*"([^"]+)"`).FindStringSubmatch(raw); len(actorMatch) >= 2 {
					for _, a := range strings.Split(actorMatch[1], ",") {
						if a = strings.TrimSpace(a); a != "" {
							var decoded string
							if err := json.Unmarshal([]byte("\""+a+"\""), &decoded); err == nil {
								a = decoded
							}
							actors = append(actors, a)
						}
					}
				}
				if dirMatch := regexp.MustCompile(`"vod_director"\s*:\s*"([^"]+)"`).FindStringSubmatch(raw); len(dirMatch) >= 2 {
					var decoded string
					if err := json.Unmarshal([]byte("\""+dirMatch[1]+"\""), &decoded); err == nil {
						director = strings.TrimSpace(decoded)
					} else {
						director = strings.TrimSpace(dirMatch[1])
					}
				}
			}
		}
	}

	// Last-resort tag source: SEO meta keywords (often mixed with the
	// title and actor names — stripActorsFromTags below removes the
	// actor overlaps, but keywords stay noisier than vod_tag, hence
	// lowest priority).
	if len(tags) == 0 && doc != nil {
		if meta, ok := doc.Find(`meta[name="keywords"]`).Attr("content"); ok {
			for _, t := range strings.Split(meta, ",") {
				if t = strings.TrimSpace(t); t != "" && len(t) < 50 {
					tags = append(tags, t)
				}
			}
		}
	}

	actors = xutil.UniqueStrings(actors, true)

	result := &sites.ScrapeResult{
		M3U8URL:    m3u8URL,
		Title:      title,
		PageURL:    pageURL,
		Tags:       stripActorsFromTags(xutil.UniqueStrings(tags, true), actors),
		Actors:     actors,
		Categories: xutil.UniqueStrings(categories, true),
		Director:   director,
	}

	scraperLogger.Info("HTTP scrape completed",
		infra.LogContext{Extra: map[string]any{
			"url":      pageURL,
			"m3u8":     m3u8URL != "",
			"title":    title,
			"actors":   len(actors),
			"tags":     len(tags),
		}})

	return result, nil
}

// stripActorsFromTags removes actor names that leaked into the tag list.
// Some site templates render actor links inside the tags block, so the
// generic tag extraction picks them up (e.g. an actress appearing both as
// Actor and Tag). Matching is exact, case-insensitive.
func stripActorsFromTags(tags, actors []string) []string {
	if len(tags) == 0 || len(actors) == 0 {
		return tags
	}
	actorSet := make(map[string]struct{}, len(actors))
	for _, a := range actors {
		actorSet[strings.ToLower(a)] = struct{}{}
	}
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		if _, hit := actorSet[strings.ToLower(t)]; hit {
			continue
		}
		out = append(out, t)
	}
	return out
}

// QuickMetadataResult holds the fast-extracted metadata from a
// lightweight HTTP scrape. It only contains title and protagonist
// (actors) — the minimum needed to give the frontend something to
// display while the full scrape continues in the background.
type QuickMetadataResult struct {
	Title       string
	Protagonist string
}

// QuickMetadataScrape performs a fast HTTP-only scrape to extract
// just the title and protagonist (actors) from the page. It uses a
// short 5-second timeout and only parses HTML metadata — no M3U8
// detection, no image extraction, no multi-page traversal.
//
// This is the "Phase 1" of the progressive scrape strategy: get
// basic metadata to the frontend in < 2 seconds, then continue with
// the full scrape (HTTP or chromedp) in the background.
func QuickMetadataScrape(ctx context.Context, pageURL string) (*QuickMetadataResult, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("quick metadata fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 304 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024)) // 2MB limit
	if err != nil {
		return nil, err
	}
	body := string(bodyBytes)

	doc, docErr := goquery.NewDocumentFromReader(strings.NewReader(body))
	if docErr != nil {
		scraperLogger.Warn("QuickMetadata goquery parse failed",
			infra.LogContext{Extra: map[string]any{"url": pageURL, "error": docErr.Error()}})
	}

	title := ""
	actors := []string{}

	if doc != nil {
		// Extract title: og:title → <title> → CleanTitle.
		if og, ok := doc.Find(`meta[property="og:title"]`).Attr("content"); ok && og != "" {
			title = og
		} else {
			title = strings.TrimSpace(doc.Find("title").First().Text())
		}
		title = CleanTitle(title)
	}

	// Extract actors from player_aaaa JSON (MacCMS/Kanav pattern).
	for _, m := range playerDataPattern.FindAllStringSubmatch(body, 1) {
		if len(m) >= 2 {
			raw := m[1]
			var pd struct {
				VodData struct {
					Actor string `json:"vod_actor"`
					Name  string `json:"vod_name"`
				} `json:"vod_data"`
			}
			if err := json.Unmarshal([]byte(raw), &pd); err == nil {
				for _, a := range strings.Split(pd.VodData.Actor, ",") {
					if a = strings.TrimSpace(a); a != "" {
						actors = append(actors, a)
					}
				}
				// Use vod_name as title fallback.
				if title == "" && pd.VodData.Name != "" {
					title = CleanTitle(strings.TrimSpace(pd.VodData.Name))
				}
			}
		}
	}

	// Also try og:description meta as a fallback source for actor hints.
	if doc != nil && len(actors) == 0 {
		doc.Find(".video-countext-tags a, .tag-list a, .actor-list a, .model-tag").Each(func(_ int, s *goquery.Selection) {
			if text := strings.TrimSpace(s.Text()); text != "" && len(text) < 30 {
				actors = append(actors, text)
			}
		})
	}

	protagonist := strings.Join(xutil.UniqueStrings(actors, true), ", ")

	scraperLogger.Info("Quick metadata extracted",
		infra.LogContext{Extra: map[string]any{
			"url":         pageURL,
			"title":       title,
			"protagonist": protagonist,
		}})

	return &QuickMetadataResult{
		Title:       title,
		Protagonist: protagonist,
	}, nil
}

// ScrapePageWithFallback wraps a scrape function with domain health-aware
// mirror domain switching. It uses DomainHealthTracker to prioritize
// healthy domains and deprioritize rate-limited ones.
func ScrapePageWithFallback(
	ctx context.Context,
	pageURL string,
	domains []string,
	scrapeFn func(context.Context, string) (*sites.ScrapeResult, error),
) (*sites.ScrapeResult, error) {
	if len(domains) == 0 {
		return scrapeFn(ctx, pageURL)
	}

	tracker := stealth.GetDomainHealthTracker()
	orderedDomains := tracker.GetAllDomainsOrdered(domains)

	var lastErr error
	for _, domain := range orderedDomains {
		targetURL := urlutil.ReplaceHost(pageURL, domain)
		result, err := scrapeFn(ctx, targetURL)
		if err == nil {
			tracker.MarkHealthy(domain)
			return result, nil
		}
		tracker.MarkRateLimited(domain)
		lastErr = err
		scraperLogger.Debug("Domain failed, trying next",
			infra.LogContext{Extra: map[string]any{
				"domain": domain,
				"error":  err.Error(),
			}})
	}

	return nil, fmt.Errorf("all domains failed: %w", lastErr)
}
