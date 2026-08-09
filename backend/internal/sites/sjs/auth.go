package sjs

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"backend/internal/sites"
)

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

type httpResponse struct {
	Body       string
	StatusCode int
	FinalURL   string
	SetCookies []string
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

func extractClassContent(html, className string) string {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return ""
	}
	content, _ := doc.Find(`div[class*="` + className + `"]`).First().Html()
	return content
}
