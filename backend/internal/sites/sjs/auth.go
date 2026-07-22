package sjs

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var authLogger = infra.NewLogger("SjsProvider")

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

// CookieJar manages cookies across multiple HTTP requests, mirroring
// the TypeScript CookieJar class for Discuz! session handling.
type CookieJar struct {
	cookies map[string]string
}

// NewCookieJar creates an empty cookie jar.
func NewCookieJar() *CookieJar {
	return &CookieJar{cookies: make(map[string]string)}
}

// LoadFromCookieData populates the jar from CookieData slices stored
// in the SiteAccountManager.
func (j *CookieJar) LoadFromCookieData(cookies []sites.CookieData) {
	for _, c := range cookies {
		j.cookies[c.Name] = c.Value
	}
}

// ParseSetCookie extracts name=value pairs from Set-Cookie headers.
func (j *CookieJar) ParseSetCookie(headers []string) {
	for _, header := range headers {
		if m := regexp.MustCompile(`^([^=]+)=([^;]*)`).FindStringSubmatch(header); len(m) >= 3 {
			j.cookies[strings.TrimSpace(m[1])] = strings.TrimSpace(m[2])
		}
	}
}

// ToHeader formats the cookies as a Cookie request header value.
func (j *CookieJar) ToHeader() string {
	if len(j.cookies) == 0 {
		return ""
	}
	var parts []string
	for k, v := range j.cookies {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

// ToCookieData converts the jar contents to CookieData for persistence.
func (j *CookieJar) ToCookieData(domain string) []sites.CookieData {
	parsed, err := url.Parse(domain)
	if err != nil {
		return nil
	}
	hostname := parsed.Hostname()
	result := make([]sites.CookieData, 0, len(j.cookies))
	for name, value := range j.cookies {
		result = append(result, sites.CookieData{
			Name:     name,
			Value:    value,
			Domain:   "." + hostname,
			Path:     "/",
			HTTPOnly: false,
			Secure:   strings.HasPrefix(domain, "https"),
			SameSite: "Lax",
		})
	}
	return result
}

// HasAuthCookie checks whether the Discuz auth cookie is present.
func (j *CookieJar) HasAuthCookie() bool {
	_, ok := j.cookies[DiscuzCookiePrefix+"auth"]
	return ok
}

// GetAuthCookieString retrieves stored cookies from the account manager
// and returns them as a Cookie header string, along with the account ID.
func GetAuthCookieString(ctx context.Context, am *sites.SiteAccountManager) (string, int) {
	if am == nil {
		return "", 0
	}
	acc, err := am.GetAvailableAccount(ctx, "sjs")
	if err != nil || acc == nil {
		return "", 0
	}

	cookies, err := am.GetAuthCookies(ctx, acc.ID)
	if err != nil || len(cookies) == 0 {
		return "", 0
	}

	jar := NewCookieJar()
	jar.LoadFromCookieData(cookies)
	return jar.ToHeader(), acc.ID
}

// HTTPLogin performs a Discuz! AJAX login via HTTP, using MD5 password
// hashing as required by the Discuz! member.php endpoint.
func HTTPLogin(ctx context.Context, am *sites.SiteAccountManager, username, password string) (*LoginResult, error) {
	tracker := stealth.GetDomainHealthTracker()
	targetDomain := tracker.GetBestDomain(SiteDomains)
	jar := NewCookieJar()

	referer := targetDomain + "/home.php?mod=space"
	homeResp, err := httpRequest(ctx, "GET", referer, jar, targetDomain+"/", nil)
	if err != nil {
		tracker.MarkRateLimited(targetDomain)
		return nil, fmt.Errorf("fetch home page: %w", err)
	}
	jar.ParseSetCookie(homeResp.SetCookies)

	formhash := extractInputValue(homeResp.Body, "formhash")
	if formhash == "" {
		return &LoginResult{Success: false, Message: "formhash not found"}, nil
	}

	loginURL := fmt.Sprintf("%s/member.php?mod=logging&action=login&loginsubmit=yes&handlekey=login&loginhash=L%s&inajax=1",
		targetDomain, getRandomString(4))
	passwordMd5 := md5Hash(password)

	body := url.Values{
		"formhash":   {formhash},
		"referer":    {referer},
		"username":   {username},
		"password":   {passwordMd5},
		"questionid": {"0"},
		"answer":     {""},
	}

	loginResp, err := httpRequest(ctx, "POST", loginURL, jar, referer, body)
	if err != nil {
		tracker.MarkRateLimited(targetDomain)
		return nil, fmt.Errorf("login request: %w", err)
	}
	jar.ParseSetCookie(loginResp.SetCookies)

	bodyText := loginResp.Body
	if strings.Contains(bodyText, "欢迎") || strings.Contains(bodyText, "登录成功") ||
	strings.Contains(bodyText, "欢迎您回来") || !strings.Contains(bodyText, "登录失败") {
		cookies := jar.ToCookieData(targetDomain)
		tracker.MarkHealthy(targetDomain)

		authLogger.Info("HTTP login successful",
			infra.LogContext{Extra: map[string]any{
				"domain":  targetDomain,
				"cookies": len(cookies),
			}})

		return &LoginResult{
			Success: true,
			Message: "login successful",
			Cookies: cookies,
			Domain:  targetDomain,
		}, nil
	}

	tracker.MarkRateLimited(targetDomain)
	return &LoginResult{Success: false, Message: "login failed"}, nil
}

// LoginResult holds the outcome of an HTTP login attempt.
type LoginResult struct {
	Success bool
	Message string
	Cookies []sites.CookieData
	Domain  string
}

type httpResponse struct {
	Body        string
	StatusCode  int
	FinalURL    string
	SetCookies  []string
}

func httpRequest(ctx context.Context, method, reqURL string, jar *CookieJar, referer string, body url.Values) (*httpResponse, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = strings.NewReader(body.Encode())
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", userAgent)
	cookieHeader := jar.ToHeader()
	if cookieHeader != "" {
		req.Header.Set("Cookie", cookieHeader)
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	if method == "POST" && body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var setCookies []string
	for _, c := range resp.Cookies() {
		setCookies = append(setCookies, c.String())
	}

	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		location := resp.Header.Get("Location")
		if location != "" {
			redirectURL := location
			if strings.HasPrefix(redirectURL, "/") {
				parsed, _ := url.Parse(reqURL)
				if parsed != nil {
					redirectURL = parsed.Scheme + "://" + parsed.Host + redirectURL
				}
			}
			jar.ParseSetCookie(setCookies)
			return httpRequest(ctx, "GET", redirectURL, jar, reqURL, nil)
		}
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return &httpResponse{
		Body:       string(respBody),
		StatusCode: resp.StatusCode,
		FinalURL:   reqURL,
		SetCookies: setCookies,
	}, nil
}

func md5Hash(input string) string {
	h := md5.Sum([]byte(input))
	return hex.EncodeToString(h[:])
}

func getRandomString(length int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, length)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func extractInputValue(html, name string) string {
	pattern1 := regexp.MustCompile(`<input[^>]*name=["']` + regexp.QuoteMeta(name) + `["'][^>]*value=["']([^"']*)["']`)
	if m := pattern1.FindStringSubmatch(html); len(m) >= 2 {
		return m[1]
	}
	pattern2 := regexp.MustCompile(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']` + regexp.QuoteMeta(name) + `["']`)
	if m := pattern2.FindStringSubmatch(html); len(m) >= 2 {
		return m[1]
	}
	return ""
}

func extractAnchorHref(html, id string) string {
	pattern1 := regexp.MustCompile(`<a[^>]*id=["']` + regexp.QuoteMeta(id) + `["'][^>]*href=["']([^"']*)["']`)
	if m := pattern1.FindStringSubmatch(html); len(m) >= 2 {
		return m[1]
	}
	pattern2 := regexp.MustCompile(`<a[^>]*href=["']([^"']*)["'][^>]*id=["']` + regexp.QuoteMeta(id) + `["']`)
	if m := pattern2.FindStringSubmatch(html); len(m) >= 2 {
		return m[1]
	}
	return ""
}

func extractClassContent(html, className string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return ""
	}
	content, _ := doc.Find(`div[class*="` + className + `"]`).First().Html()
	return content
}

func extractElementText(html, selector string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return ""
	}

	idMatch := regexp.MustCompile(`id=['"]([^'"]+)['"]`).FindStringSubmatch(selector)
	if len(idMatch) >= 2 {
		return strings.TrimSpace(doc.Find("#" + idMatch[1]).First().Text())
	}
	return ""
}
