package stealth

import (
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// WafBlockReason categorizes the type of WAF or anti-bot block detected.
type WafBlockReason string

const (
	WafReasonCloudflare          WafBlockReason = "cloudflare"
	WafReasonHTTP403             WafBlockReason = "http_403"
	WafReasonHTTP429             WafBlockReason = "http_429"
	WafReasonHTTP503             WafBlockReason = "http_503"
	WafReasonJavaScriptChallenge WafBlockReason = "javascript_challenge"
	WafReasonCaptcha             WafBlockReason = "captcha"
	WafReasonEmptyContent        WafBlockReason = "empty_content"
	WafReasonWafPage             WafBlockReason = "waf_page"
	WafReasonNone                WafBlockReason = "none"
)

// WafDetectionResult reports whether a WAF block was detected and why.
type WafDetectionResult struct {
	Blocked bool
	Reason  WafBlockReason
	Detail  string
}

var cloudflareSignatures = []string{
	"cf-browser-verification",
	"cf-challenge-running",
	"cloudflare",
	"checking your browser before accessing",
	"just a moment",
	"_cf_chl_opt",
	"cf-mitigated",
	"ray id",
	"cf-ray",
	"cf_chl_prog",
	"cf-chl-bypass",
	"challenge-platform",
	"cdn-cgi/challenge",
	"cloudflare-static/challenge",
	"turnstile",
	"cf-turnstile",
	"cf_chl_jschl_tk",
	"jschl_vc",
	"jschl_answer",
	"cf_chl_captcha_tk",
	"captcha-container",
}

var wafSignatures = []string{
	"access denied",
	"请求被拦截",
	"您的请求被拦截",
	"blocked by security",
	"security check",
	"安全检查",
	" firewall",
	"rate limit",
	"too many requests",
	"请求过于频繁",
	"access to this page has been denied",
	"incapsula incident",
	"sucuri website firewall",
	"blocked by protection",
}

var captchaSignatures = []string{
	"captcha",
	"recaptcha",
	"hcaptcha",
	"geetest",
	"verify you are human",
	"请完成验证",
	"人机验证",
	"g-recaptcha",
	"h-captcha",
}

var jsChallengeSignatures = []string{
	"请启用javascript",
	"enable javascript",
	"requires javascript",
	"noscript",
	"javascript is disabled",
	"needs javascript",
}

func containsAnyCI(content string, signatures []string) bool {
	lower := strings.ToLower(content)
	for _, sig := range signatures {
		if strings.Contains(lower, strings.ToLower(sig)) {
			return true
		}
	}
	return false
}

// DetectWaf checks HTTP status code and HTML content for WAF blocks,
// returning a structured result that callers use to decide fallback.
func DetectWaf(statusCode int, html string, doc *goquery.Document) WafDetectionResult {
	if statusCode == 403 {
		return WafDetectionResult{Blocked: true, Reason: WafReasonHTTP403, Detail: "HTTP 403 Forbidden (WAF block)"}
	}
	if statusCode == 429 {
		return WafDetectionResult{Blocked: true, Reason: WafReasonHTTP429, Detail: "HTTP 429 Too Many Requests (rate limited)"}
	}

	if statusCode == 503 {
		if html != "" && containsAnyCI(html, cloudflareSignatures) {
			return WafDetectionResult{Blocked: true, Reason: WafReasonCloudflare, Detail: "HTTP 503 + Cloudflare challenge detected"}
		}
		if html != "" && containsAnyCI(html, wafSignatures) {
			return WafDetectionResult{Blocked: true, Reason: WafReasonWafPage, Detail: "HTTP 503 + WAF signature detected"}
		}
	}

	if html == "" {
		return WafDetectionResult{Blocked: false, Reason: WafReasonNone, Detail: "No content to analyze"}
	}

	if containsAnyCI(html, cloudflareSignatures) && len(html) < 15000 {
		return WafDetectionResult{Blocked: true, Reason: WafReasonCloudflare, Detail: "HTML contains Cloudflare signature"}
	}

	if containsAnyCI(html, captchaSignatures) && len(html) < 10000 {
		return WafDetectionResult{Blocked: true, Reason: WafReasonCaptcha, Detail: "HTML contains CAPTCHA signature"}
	}

	if containsAnyCI(html, jsChallengeSignatures) && len(html) < 8000 {
		return WafDetectionResult{Blocked: true, Reason: WafReasonJavaScriptChallenge, Detail: "HTML contains JavaScript challenge"}
	}

	if len(html) < 5000 && containsAnyCI(html, wafSignatures) {
		return WafDetectionResult{Blocked: true, Reason: WafReasonWafPage, Detail: "HTML contains WAF signature"}
	}

	if doc != nil {
		title := strings.ToLower(strings.TrimSpace(doc.Find("title").Text()))
		if strings.Contains(title, "just a moment") || strings.Contains(title, "attention required") || strings.Contains(title, "access denied") {
			return WafDetectionResult{Blocked: true, Reason: WafReasonWafPage, Detail: "title indicates WAF block: " + title}
		}

		// Only flag Cloudflare CHALLENGE scripts, not all Cloudflare
		// scripts (Rocket Loader, analytics, etc. are legitimate).
		if doc.Find(`script[src*="cdn-cgi/challenge-platform"]`).Length() > 0 ||
			doc.Find(`script[src*="cdn-cgi/cloudflare-static/challenge"]`).Length() > 0 ||
			doc.Find(`script[src*="cf-chl"]`).Length() > 0 ||
			doc.Find(`script[src*="cf_chl"]`).Length() > 0 ||
			doc.Find(`script[src*="turnstile"]`).Length() > 0 ||
			doc.Find(`script[id="cf-challenge-script"]`).Length() > 0 {
			return WafDetectionResult{Blocked: true, Reason: WafReasonCloudflare, Detail: "HTML contains Cloudflare challenge script"}
		}

		bodyChildren := doc.Find("body").Children().Length()
		hasArticle := doc.Find("article").Length() > 0
		hasMainContent := doc.Find("main, .entry-content, .post-content, #content").Length() > 0
		if bodyChildren <= 3 && !hasArticle && !hasMainContent && len(html) < 3000 {
			return WafDetectionResult{Blocked: true, Reason: WafReasonEmptyContent, Detail: "Empty content detected"}
		}
	}

	return WafDetectionResult{Blocked: false, Reason: WafReasonNone, Detail: ""}
}

// ShouldFallbackToBrowser checks whether an HTTP scrape result is
// suspiciously empty, indicating a need for browser-based fallback.
func ShouldFallbackToBrowser(title string, imageCount, videoCount, pageCount int) (bool, string) {
	if imageCount == 0 && videoCount == 0 {
		return true, "No images or videos found, possible WAF block"
	}

	if title == "" || title == "404" || strings.Contains(title, "Not Found") || strings.Contains(title, "Error") {
		return true, "Invalid title: " + title
	}

	if pageCount > 1 && imageCount < pageCount*3 {
		return true, "Low image count relative to page count"
	}

	expectedCount := parseExpectedImageCount(title)
	if expectedCount > 0 && imageCount > 0 {
		ratio := float64(imageCount) / float64(expectedCount)
		if ratio < 0.7 {
			return true, "Image count mismatch with title hint"
		}
	}

	return false, ""
}

func parseExpectedImageCount(title string) int {
	// Match "P" suffix like 73P, 100P
	for i := len(title) - 1; i >= 0; i-- {
		if (title[i] == 'P' || title[i] == 'p') && i > 0 {
			numStart := i
			for numStart > 0 && title[numStart-1] >= '0' && title[numStart-1] <= '9' {
				numStart--
			}
			if numStart < i {
				n := 0
				for j := numStart; j < i; j++ {
					n = n*10 + int(title[j]-'0')
				}
				if i == len(title)-1 || !isLetter(title[i+1]) {
					return n
				}
			}
		}
	}
	return 0
}

func isLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}
