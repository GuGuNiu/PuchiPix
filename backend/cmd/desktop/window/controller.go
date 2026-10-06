package window

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Options configures the window chrome the controller publishes to the
// frontend through /api/window/state.
type Options struct {
	// CornerRadiusPx is the rounded-corner radius (CSS pixels) the web shell
	// applies to the window frame. Zero keeps square corners; the frontend
	// drops the radius while the window is maximised.
	CornerRadiusPx int
}

type Controller struct {
	mu   sync.RWMutex
	ctx  context.Context
	opts Options
}

func New(opts Options) *Controller {
	return &Controller{opts: opts}
}

func (c *Controller) Bind(ctx context.Context) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ctx = ctx
}

func (c *Controller) runtimeContext() (context.Context, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.ctx == nil {
		return nil, false
	}
	return c.ctx, true
}

func (c *Controller) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/window/state", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		c.writeState(w)
	})

	mux.HandleFunc("/api/window/minimise", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		c.run(w, runtime.WindowMinimise)
	})

	mux.HandleFunc("/api/window/toggle-maximise", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		c.run(w, runtime.WindowToggleMaximise)
	})

	mux.HandleFunc("/api/window/close", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		c.run(w, runtime.Quit)
	})

	return mux
}

func (c *Controller) writeState(w http.ResponseWriter) {
	ctx, ok := c.runtimeContext()
	payload := map[string]any{
		"maximised":    false,
		"cornerRadius": c.opts.CornerRadiusPx,
	}
	if ok {
		payload["maximised"] = runtime.WindowIsMaximised(ctx)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (c *Controller) run(w http.ResponseWriter, fn func(context.Context)) {
	ctx, ok := c.runtimeContext()
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "window runtime not ready",
		})
		return
	}
	fn(ctx)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, POST")
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{
		"error": "method not allowed",
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
