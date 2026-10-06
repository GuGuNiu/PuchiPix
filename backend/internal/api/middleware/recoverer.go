package middleware

import (
	"net/http"
	"runtime/debug"

	"backend/internal/infra"
)

func Recoverer(next http.Handler) http.Handler {
	logger := infra.NewLogger("Recoverer")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("Panic recovered", rec)
				debug.PrintStack()
				writePanicError(w)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writePanicError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	w.Write([]byte(`{"error":"Internal server error"}`))
}
