package sites

import (
	"context"
	"sync"
	"time"

	"backend/internal/infra"
)

// CapturedURL represents a URL discovered by the Sniffer during page
// network interception.
type CapturedURL struct {
	URL      string `json:"url"`
	Type     string `json:"type"`
	Timestamp string `json:"timestamp"`
	PageURL  string `json:"page_url"`
	Filename string `json:"filename"`
}

// SniffStatus reports the current state of a sniffing operation.
type SniffStatus struct {
	Running   bool   `json:"running"`
	TargetURL string `json:"target_url"`
	Captured  int    `json:"captured"`
	StartTime string `json:"start_time"`
}

// Sniffer captures M3U8 URLs from network traffic by navigating to a
// target page and intercepting media requests. The Go implementation
// uses chromedp's network domain for request interception.
type Sniffer struct {
	mu           sync.Mutex
	running      bool
	targetURL    string
	capturedURLs []CapturedURL
	startTime    string
	logger       *infra.Logger
}

// NewSniffer creates a new Sniffer instance.
func NewSniffer() *Sniffer {
	return &Sniffer{
		logger: infra.NewLogger("Sniffer"),
	}
}

// Start begins sniffing M3U8 URLs from the given target page.
// The actual network interception is handled by the caller via chromedp
// actions, feeding captured URLs through AddCapturedURL.
func (s *Sniffer) Start(ctx context.Context, url string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return ErrSnifferAlreadyRunning
	}

	s.targetURL = url
	s.capturedURLs = nil
	s.startTime = time.Now().UTC().Format(time.RFC3339)
	s.running = true

	s.logger.Info("Sniffer started",
		infra.LogContext{Extra: map[string]any{"url": url}})
	return nil
}

// Stop ends the current sniffing session.
func (s *Sniffer) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	s.logger.Info("Sniffer stopped",
		infra.LogContext{Extra: map[string]any{
			"captured": len(s.capturedURLs),
		}})
}

// AddCapturedURL appends a discovered URL to the capture list.
// This is called by chromedp network event handlers.
func (s *Sniffer) AddCapturedURL(url, filename string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.capturedURLs {
		if existing.URL == url {
			return
		}
	}

	s.capturedURLs = append(s.capturedURLs, CapturedURL{
		URL:       url,
		Type:      "m3u8",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		PageURL:   s.targetURL,
		Filename:  filename,
	})
}

// GetStatus returns the current sniffing status.
func (s *Sniffer) GetStatus() SniffStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return SniffStatus{
		Running:   s.running,
		TargetURL: s.targetURL,
		Captured:  len(s.capturedURLs),
		StartTime: s.startTime,
	}
}

// GetCapturedURLs returns all captured URLs.
func (s *Sniffer) GetCapturedURLs() []CapturedURL {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]CapturedURL, len(s.capturedURLs))
	copy(result, s.capturedURLs)
	return result
}

// GetM3U8URLs returns only M3U8-type captured URLs.
func (s *Sniffer) GetM3U8URLs() []CapturedURL {
	all := s.GetCapturedURLs()
	var result []CapturedURL
	for _, u := range all {
		if u.Type == "m3u8" {
			result = append(result, u)
		}
	}
	return result
}

var (
	snifferOnce sync.Once
	snifferInst *Sniffer
)

// GetSniffer returns the singleton Sniffer instance.
func GetSniffer() *Sniffer {
	snifferOnce.Do(func() {
		snifferInst = NewSniffer()
	})
	return snifferInst
}
