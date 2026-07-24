package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"backend/internal/api/middleware"
	"backend/internal/i18n"
	"backend/internal/infra"
)

// NewRouter builds the chi router with the full middleware chain and
// all API endpoint groups registered, mirroring the Next.js App
// Router API structure.
func NewRouter(h *Handlers, eventBus *infra.EventBus) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(middleware.RequestID)
	r.Use(middleware.RateLimiter)
	r.Use(middleware.LocaleDetection)
	r.Use(middleware.CORS)
	r.Use(middleware.Recoverer)
	r.Use(chimw.StripSlashes)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", h.Health)
		r.Post("/admin/fix-galleries", h.FixGalleries) // TEMP: fix failed gallery statuses
		r.Get("/system", h.System)
		r.Get("/stats", h.Stats)
		r.Get("/sites", h.Sites)

		r.Get("/logs", h.LogsSSE)
		r.Get("/logs/history", h.LogsHistory)
		r.Get("/logs/latest", h.LogsLatest)

		r.Route("/dag", func(r chi.Router) {
			r.Get("/", h.DagList)
			r.Get("/stream", h.DagStreamSSE)
			r.Get("/{id}", h.DagDetail)
			r.Post("/{id}/control", h.DagControl)
			r.Get("/{id}/nodes", h.DagNodes)
			r.Get("/{id}/snapshot", h.DagSnapshot)
		})

		// Slot pool monitoring and dynamic configuration endpoints.
		// GET  /api/slots         - real-time slot usage snapshot
		// GET  /api/slots/holders - active holder IDs for leak diagnosis
		// GET  /api/slots/{type}  - detailed info for a single slot type
		// PUT  /api/slots/{type}  - dynamically adjust max concurrency
		r.Route("/slots", func(r chi.Router) {
			r.Get("/", h.SlotList)
			r.Get("/holders", h.SlotHolders)
			r.Get("/{type}", h.SlotDetail)
			r.Put("/{type}", h.SlotUpdate)
		})

		r.Route("/tasks", func(r chi.Router) {
			r.Get("/", h.TaskList)
			r.Get("/stream", h.TaskStreamSSE)
			r.Post("/", h.TaskCreate)
			r.Get("/{id}", h.TaskDetail)
			r.Post("/{id}", h.TaskAction)
			r.Delete("/{id}", h.TaskDelete)
		})

		r.Route("/shelf", func(r chi.Router) {
			r.Get("/", h.ShelfList)
			r.Get("/sjs", h.SjsShelfList)
			r.Post("/sjs", h.SjsShelfCreate)
			r.Delete("/sjs", h.SjsShelfDelete)
			r.Get("/sjs/bookmarks", h.SjsBookmarksList)
			r.Post("/sjs/bookmarks", h.SjsBookmarksCreate)
			r.Patch("/sjs/bookmarks", h.SjsBookmarksUpdate)
			r.Delete("/sjs/bookmarks", h.SjsBookmarksDelete)
			r.Get("/{id}", h.ShelfDetail)
			r.Get("/{id}/images", h.GalleryImages)
			r.Delete("/{id}", h.ShelfDelete)
			r.Post("/{id}", h.ShelfAction)
			// Fine-grained retry: retry individual files or ranges.
			r.Post("/{id}/files/retry", h.GalleryFileRetry)
			r.Get("/{id}/files/progress", h.GalleryFileProgress)
		})

		r.Route("/accounts", func(r chi.Router) {
			r.Get("/", h.AccountsList)
			r.Post("/", h.AccountsCreate)
			r.Put("/{id}", h.AccountsUpdate)
			r.Delete("/{id}", h.AccountsDelete)
		})

		r.Route("/persons", func(r chi.Router) {
			r.Get("/", h.PersonsList)
			r.Post("/", h.PersonsCreate)
			r.Put("/{id}", h.PersonsUpdate)
			r.Delete("/{id}", h.PersonsDelete)
		})

		r.Route("/blocklist", func(r chi.Router) {
			r.Get("/", h.BlocklistList)
			r.Post("/", h.BlocklistCreate)
			r.Put("/{id}", h.BlocklistUpdate)
			r.Delete("/", h.BlocklistDelete)
		})

		r.Get("/config", h.ConfigList)
		r.Put("/config", h.ConfigUpdate)

		r.Get("/task-settings", h.TaskSettingsList)
		r.Put("/task-settings", h.TaskSettingsUpdate)

		r.Get("/preferences", h.PreferencesList)
		r.Put("/preferences", h.PreferencesUpdate)

		r.Route("/search", func(r chi.Router) {
			r.Get("/", h.Search)
			r.Post("/", h.Search)
			r.Post("/batch", h.SearchBatch)
			r.Get("/{id}", h.SearchDetail)
			r.Delete("/{id}", h.SearchDelete)
		})

		r.Post("/scrape", h.Scrape)
		r.Post("/ouo", h.Ouo)
		r.Post("/proxy", h.Proxy)
		r.Get("/proxy", h.ServeFile)
		r.Post("/sjs", h.Sjs)

		r.Get("/sniff", h.SniffList)
		r.Post("/sniff", h.SniffCreate)
		r.Delete("/sniff", h.SniffDelete)

		r.Get("/preview", h.Preview)
		r.Post("/preview", h.PreviewPost)
		r.Get("/protagonists", h.Protagonists)
		r.Get("/history", h.History)
		r.Get("/character-db", h.CharacterDB)
		r.Get("/game-characters", h.GameCharacters)
	})

	r.Get("/ws", WSHandler(eventBus))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.common.endpointNotFound"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, i18n.TFromRequest(r, "api.common.methodNotAllowed"))
	})

	return r
}
