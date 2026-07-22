package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"backend/internal/api"
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
		r.Get("/system", h.System)
		r.Get("/stats", h.Stats)
		r.Get("/sites", h.Sites)

		r.Get("/logs", h.LogsSSE)
		r.Get("/logs/history", h.LogsHistory)
		r.Get("/logs/query", h.LogsQuery)
		r.Get("/logs/latest", h.LogsLatest)

		r.Route("/dag", func(r chi.Router) {
			r.Get("/", h.DagList)
			r.Get("/stream", h.DagStreamSSE)
			r.Get("/{id}", h.DagDetail)
			r.Post("/{id}/control", h.DagControl)
			r.Get("/{id}/nodes", h.DagNodes)
			r.Get("/{id}/snapshot", h.DagSnapshot)
		})

		r.Route("/tasks", func(r chi.Router) {
			r.Get("/", h.TaskList)
			r.Get("/stream", h.TaskStreamSSE)
			r.Post("/", h.TaskCreate)
			r.Get("/{id}", h.TaskDetail)
			r.Post("/{id}", h.TaskAction)
		})

		r.Route("/shelf", func(r chi.Router) {
			r.Get("/", h.ShelfList)
			r.Get("/sjs", h.SjsShelfList)
			r.Get("/sjs/bookmarks", h.SjsBookmarksList)
			r.Post("/sjs/bookmarks", h.SjsBookmarksCreate)
			r.Delete("/sjs/bookmarks", h.SjsBookmarksDelete)
			r.Get("/{id}", h.ShelfDetail)
			r.Get("/{id}/images", h.GalleryImages)
			r.Delete("/{id}", h.ShelfDelete)
			r.Post("/{id}", h.ShelfAction)
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
			r.Delete("/{id}", h.BlocklistDelete)
		})

		r.Get("/config", h.ConfigList)
		r.Put("/config", h.ConfigUpdate)

		r.Get("/preferences", h.PreferencesList)
		r.Put("/preferences", h.PreferencesUpdate)

		r.Get("/task-settings", h.TaskSettingsList)
		r.Put("/task-settings", h.TaskSettingsUpdate)

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

		r.Get("/preview", h.Preview)
		r.Get("/protagonists", h.Protagonists)
		r.Get("/history", h.History)
		r.Get("/character-db", h.CharacterDB)
	})

	r.Get("/ws", api.WSHandler(eventBus))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, i18n.TFromRequest(r, "api.common.endpointNotFound"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, i18n.TFromRequest(r, "api.common.methodNotAllowed"))
	})

	return r
}
