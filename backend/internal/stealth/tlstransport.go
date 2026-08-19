package stealth

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/net/http2"

	utls "github.com/refraction-networking/utls"
)

// dialUTLS establishes a uTLS connection with Chrome's ClientHello spec.
// Used by http2.Transport.DialTLSContext so that HTTP/2 requests also
// have Chrome's TLS fingerprint.
func dialUTLS(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	if port == "" {
		port = "443"
	}

	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	rawConn, err := dialer.DialContext(ctx, network, net.JoinHostPort(host, port))
	if err != nil {
		return nil, err
	}

	tlsConn := utls.UClient(rawConn, &utls.Config{
		ServerName: host,
	}, utls.HelloChrome_Auto)

	if err := tlsConn.HandshakeContext(ctx); err != nil {
		rawConn.Close()
		return nil, err
	}

	return tlsConn, nil
}

// NewStealthClient creates an HTTP client that uses uTLS to mimic Chrome's
// TLS ClientHello fingerprint, bypassing Cloudflare's JA3/JA4-based bot
// detection. It handles both HTTP/1.1 and HTTP/2 by checking the ALPN
// negotiation result after the uTLS handshake.
func NewStealthClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &stealthTransport{
			timeout: timeout,
		},
	}
}

type stealthTransport struct {
	timeout time.Duration

	// plainTransport handles non-TLS URLs. Some tests and mirror domains
	// intentionally use http://; forcing uTLS there turns a valid request
	// into a TLS handshake against a plaintext server.
	plainOnce      sync.Once
	plainTransport *http.Transport

	// http2Transport is lazily initialized and reused for HTTP/2 requests.
	h2Once      sync.Once
	h2Transport *http2.Transport
}

func (t *stealthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" {
		t.plainOnce.Do(func() {
			t.plainTransport = &http.Transport{
				DialContext: (&net.Dialer{
					Timeout:   10 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				MaxIdleConns:          100,
				MaxIdleConnsPerHost:   10,
				IdleConnTimeout:       90 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
				DisableCompression:    false,
			}
		})
		return t.plainTransport.RoundTrip(req)
	}

	// Connect TCP.
	host := req.URL.Hostname()
	port := req.URL.Port()
	if port == "" {
		port = "443"
	}

	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	rawConn, err := dialer.DialContext(req.Context(), "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return nil, fmt.Errorf("dial tcp: %w", err)
	}

	// Wrap with uTLS using Chrome's ClientHello spec.
	tlsConn := utls.UClient(rawConn, &utls.Config{
		ServerName: host,
	}, utls.HelloChrome_Auto)

	if err := tlsConn.HandshakeContext(req.Context()); err != nil {
		rawConn.Close()
		return nil, fmt.Errorf("tls handshake: %w", err)
	}

	// Check ALPN negotiation result.
	state := tlsConn.ConnectionState()
	switch state.NegotiatedProtocol {
	case "h2":
		// Server negotiated HTTP/2 — use http2.Transport which
		// handles the HTTP/2 framing protocol natively.
		t.h2Once.Do(func() {
			t.h2Transport = &http2.Transport{
				AllowHTTP: false,
				DialTLSContext: func(ctx context.Context, network, addr string, cfg *tls.Config) (net.Conn, error) {
					_ = cfg // We use uTLS's own config, not the standard tls.Config
					return dialUTLS(ctx, network, addr)
				},
			}
		})
		// Close our manually-dialed connection — http2.Transport
		// will create its own via DialTLSContext.
		tlsConn.Close()
		return t.h2Transport.RoundTrip(req)
	default:
		// Server negotiated HTTP/1.1 (or no ALPN) — send the
		// request directly on the TLS connection.
		return t.roundTripHTTP1(req, tlsConn)
	}
}

// roundTripHTTP1 sends an HTTP/1.1 request directly on a TLS connection
// and reads the response, avoiding http.Transport's limitations with
// non-standard TLS connections.
func (t *stealthTransport) roundTripHTTP1(req *http.Request, tlsConn net.Conn) (*http.Response, error) {
	req.Proto = "HTTP/1.1"
	req.ProtoMajor = 1
	req.ProtoMinor = 1
	req.Host = req.URL.Host

	if err := req.Write(tlsConn); err != nil {
		tlsConn.Close()
		return nil, fmt.Errorf("write request: %w", err)
	}

	resp, err := http.ReadResponse(bufio.NewReader(tlsConn), req)
	if err != nil {
		tlsConn.Close()
		return nil, fmt.Errorf("read response: %w", err)
	}

	resp.Body = &connClosingBody{
		ReadCloser: resp.Body,
		conn:       tlsConn,
	}

	return resp, nil
}

type connClosingBody struct {
	io.ReadCloser
	conn net.Conn
}

func (b *connClosingBody) Close() error {
	b.ReadCloser.Close()
	b.conn.Close()
	return nil
}
