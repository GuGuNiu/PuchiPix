package middleware

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

type ctxKey string

const reqIDKey ctxKey = "requestID"

// RequestID wraps chi's built-in RequestID to also store the value
// in a typed context key for downstream logger retrieval.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := middleware.GetReqID(r.Context())
		if reqID == "" {
			reqID = "auto-" + randomHex(8)
		}
		w.Header().Set("X-Request-Id", reqID)
		ctx := context.WithValue(r.Context(), reqIDKey, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
