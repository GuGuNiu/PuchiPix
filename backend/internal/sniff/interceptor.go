package sniff

import (
	"context"
	"fmt"

	"puchipix-backend/pkg/logger"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
)

type Interceptor struct {
	sniffer *SniffInstance
}

func NewInterceptor(s *SniffInstance) *Interceptor {
	return &Interceptor{sniffer: s}
}

func (it *Interceptor) Enable(ctx context.Context) error {
	if err := network.Enable().Do(ctx); err != nil {
		return fmt.Errorf("failed to enable network events: %w", err)
	}

	chromedp.ListenTarget(ctx, func(ev interface{}) {
		switch e := ev.(type) {
		case *network.EventRequestWillBeSent:
			it.handleRequest(e)
		}
	})

	logger.Info("Network interception enabled")
	return nil
}

func (it *Interceptor) handleRequest(ev *network.EventRequestWillBeSent) {
	url := ev.Request.URL
	if len(url) < 5 {
		return
	}

	suffix := url[len(url)-5:]
	if suffix == ".m3u8" {
		it.sniffer.mu.Lock()
		it.sniffer.urls = append(it.sniffer.urls, CapturedURL{
			URL:       url,
			Type:      "m3u8",
			Timestamp: ev.Timestamp.Time(),
			PageURL:   ev.DocumentURL,
			Filename:  extractFilename(url),
		})
		it.sniffer.mu.Unlock()
		logger.Info("Interceptor captured M3U8: %s", url)
	}
}

func (it *Interceptor) Disable(ctx context.Context) error {
	return network.Disable().Do(ctx)
}