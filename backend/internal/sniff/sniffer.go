package sniff

import (
	"context"
	"fmt"
	"sync"
	"time"

	"puchipix-backend/pkg/logger"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
)

type SniffInstance struct {
	ctx        context.Context
	cancel     context.CancelFunc
	urls       []CapturedURL
	mu         sync.RWMutex
	isRunning  bool
	targetURL  string
}

type CapturedURL struct {
	URL       string    `json:"url"`
	Type      string    `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	PageURL   string    `json:"page_url"`
	Filename  string    `json:"filename"`
}

type SniffStatus struct {
	Running   bool      `json:"running"`
	TargetURL string    `json:"target_url"`
	Captured  int       `json:"captured"`
	StartTime time.Time `json:"start_time"`
}

var (
	instance  *SniffInstance
	once      sync.Once
	startTime time.Time
)

func GetInstance() *SniffInstance {
	once.Do(func() {
		instance = &SniffInstance{
			urls: make([]CapturedURL, 0),
		}
	})
	return instance
}

func (s *SniffInstance) Start(chromePath string, targetURL string) error {
	s.mu.Lock()
	if s.isRunning {
		s.mu.Unlock()
		return fmt.Errorf("sniffer already running")
	}

	allocCtx, _ := chromedp.NewExecAllocator(
		context.Background(),
		append(chromedp.DefaultExecAllocatorOptions[:],
			chromedp.Flag("headless", true),
			chromedp.Flag("disable-gpu", true),
			chromedp.Flag("no-sandbox", true),
			chromedp.Flag("disable-dev-shm-usage", true),
			chromedp.Flag("disable-web-security", true),
			chromedp.Flag("ignore-certificate-errors", true),
			chromedp.ExecPath(chromePath),
		)...,
	)

	ctx, cancel := chromedp.NewContext(allocCtx)

	s.ctx = ctx
	s.cancel = cancel
	s.targetURL = targetURL
	s.isRunning = true
	s.urls = make([]CapturedURL, 0)
	startTime = time.Now()
	s.mu.Unlock()

	logger.Info("Sniffer starting for URL: %s", targetURL)

	go func() {
		if err := chromedp.Run(ctx, sniffTasks(targetURL, s)); err != nil && err != context.Canceled {
			logger.Error("Sniffer error: %v", err)
			s.mu.Lock()
			s.isRunning = false
			s.mu.Unlock()
		}
	}()

	return nil
}

func sniffTasks(targetURL string, s *SniffInstance) chromedp.Tasks {
	return chromedp.Tasks{
		network.Enable(),
		chromedp.ActionFunc(func(ctx context.Context) error {
			logger.Info("Navigating to %s", targetURL)
			return nil
		}),
		chromedp.Navigate(targetURL),
		chromedp.ActionFunc(func(ctx context.Context) error {
			logger.Info("Page loaded, listening for network events...")

			chromedp.ListenTarget(ctx, func(ev interface{}) {
				switch e := ev.(type) {
				case *network.EventRequestWillBeSent:
					url := e.Request.URL
					if len(url) > 5 && url[len(url)-5:] == ".m3u8" {
						s.mu.Lock()
						s.urls = append(s.urls, CapturedURL{
							URL:       url,
							Type:      "m3u8",
							Timestamp: time.Now(),
							PageURL:   e.DocumentURL,
							Filename:  extractFilename(url),
						})
						count := len(s.urls)
						s.mu.Unlock()
						logger.Info("Captured M3U8 URL: %s (total: %d)", url, count)
					}
				}
			})
			return nil
		}),
		chromedp.ActionFunc(func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		}),
	}
}

func extractFilename(url string) string {
	for i := len(url) - 1; i >= 0; i-- {
		if url[i] == '/' {
			return url[i+1:]
		}
	}
	return url
}

func (s *SniffInstance) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.isRunning {
		return fmt.Errorf("sniffer not running")
	}

	if s.cancel != nil {
		s.cancel()
	}
	s.isRunning = false
	logger.Info("Sniffer stopped")
	return nil
}

func (s *SniffInstance) GetStatus() SniffStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return SniffStatus{
		Running:   s.isRunning,
		TargetURL: s.targetURL,
		Captured:  len(s.urls),
		StartTime: startTime,
	}
}

func (s *SniffInstance) GetCapturedURLs() []CapturedURL {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]CapturedURL, len(s.urls))
	copy(result, s.urls)
	return result
}

func (s *SniffInstance) GetM3U8URLs() []CapturedURL {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []CapturedURL
	for _, u := range s.urls {
		if u.Type == "m3u8" {
			result = append(result, u)
		}
	}
	return result
}