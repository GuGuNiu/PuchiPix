package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

// Dist holds the built frontend. The directory is populated by
// scripts/sync-dist.mjs (or the desktop build script) from frontend/dist
// before `go build`; a placeholder index.html keeps the package compilable
// when the frontend has not been built yet.
//
//go:embed all:dist
var distFS embed.FS

// Handler serves the embedded frontend with SPA fallback and the same
// security headers and cache policy the retired nginx.conf applied, so the
// desktop build keeps the previous deployment's browser-visible semantics.
//
// The handler is mounted on the same origin as the API, which keeps every
// frontend request a relative /api call and therefore removes the CORS and
// proxy layers the nginx deployment needed.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend assets unavailable", http.StatusInternalServerError)
		})
	}
	files := http.FileServer(http.FS(sub))
	return &spaHandler{files: files, sub: sub}
}

type spaHandler struct {
	files http.Handler
	sub   fs.FS
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	applySecurityHeaders(w)

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cleaned := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
	if cleaned == "/" {
		h.serveIndex(w, r)
		return
	}

	if f, err := h.sub.Open(strings.TrimPrefix(cleaned, "/")); err == nil {
		info, statErr := f.Stat()
		f.Close()
		if statErr == nil && !info.IsDir() {
			if strings.HasPrefix(cleaned, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			h.files.ServeHTTP(w, r)
			return
		}
	}

	h.serveIndex(w, r)
}

func (h *spaHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := fs.ReadFile(h.sub, "index.html")
	if err != nil {
		http.Error(w, "index.html unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.html", time.Time{}, strings.NewReader(string(data)))
}

func applySecurityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; connect-src 'self' ws: wss: http: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}