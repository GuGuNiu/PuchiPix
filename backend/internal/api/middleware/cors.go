package middleware

import (
	"net/http"

	"github.com/go-chi/cors"
)

// CORS returns a permissive CORS middleware that allows the Next.js
// frontend origin and standard headers, matching the development
// behavior of the TypeScript backend.
func CORS(next http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "x-locale"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           300,
	})
	return c.Handler(next)
}
