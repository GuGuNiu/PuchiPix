package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/cors"
)

func CORS(next http.Handler) http.Handler {
	origins := []string{"http://localhost:10540", "http://127.0.0.1:10540"}
	if configured := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS")); configured != "" {
		origins = nil
		for _, origin := range strings.Split(configured, ",") {
			if origin = strings.TrimSpace(origin); origin != "" {
				origins = append(origins, origin)
			}
		}
	}
	allowCredentials := true
	for _, origin := range origins {
		if origin == "*" {
			allowCredentials = false
			break
		}
	}
	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Key", "x-locale"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: allowCredentials,
		MaxAge:           300,
	})
	return c.Handler(next)
}
