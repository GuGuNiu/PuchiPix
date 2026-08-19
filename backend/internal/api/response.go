package api

import (
	"net/http"

	"backend/internal/api/internal/response"
)

// writeJSON encodes data as JSON and writes it with the given status.
func writeJSON(w http.ResponseWriter, status int, data any) {
	response.WriteJSON(w, status, data)
}

// writeError sends a uniform error envelope matching the Next.js
// `{ error: string }` contract.
func writeError(w http.ResponseWriter, status int, message string) {
	response.WriteError(w, status, message)
}

// decodeJSON decodes the request body into dst, returning false and
// writing a 400 error if the body is missing or malformed.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	return response.DecodeJSON(w, r, dst)
}

// queryInt extracts an integer query parameter with a fallback default.
func queryInt(r *http.Request, key string, def int) int {
	return response.QueryInt(r, key, def)
}
