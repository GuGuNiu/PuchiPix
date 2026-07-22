package infra

import (
	"net"
	"net/http"
	"time"
)

// DefaultHTTPTimeout is the fallback request timeout when none is
// specified, chosen to accommodate slow gallery archive downloads
// while still catching genuinely hung connections.
const DefaultHTTPTimeout = 120 * time.Second

// NewHTTPClient returns an *http.Client configured for connection reuse
// and sane timeouts, replacing the TypeScript shared HttpClient. The
// transport pool keeps idle connections alive to avoid TCP handshake
// overhead on repeated requests to the same host.
func NewHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = DefaultHTTPTimeout
	}
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:  10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
		ForceAttemptHTTP2:     true,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

// DefaultHeaders returns a baseline set of headers that mimic a real
// browser, reducing the chance of being blocked by basic anti-crawler
// checks on target gallery sites.
func DefaultHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
	h.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	return h
}
