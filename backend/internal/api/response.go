package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"backend/internal/i18n"
)

// writeJSON encodes data as JSON and writes it with the given status.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

// writeError sends a uniform error envelope matching the Next.js
// `{ error: string }` contract. All error responses use this to
// maintain a consistent structure across the API.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeConflict sends a 409 Conflict response with a structured error
// message, used when the request conflicts with the current server state
// (e.g. duplicate resource creation, already-running task).
func writeConflict(w http.ResponseWriter, r *http.Request, message string) {
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":  message,
		"code":   "CONFLICT",
		"status": http.StatusConflict,
	})
}

// decodeJSON decodes the request body into dst, returning false and
// writing a 400 error if the body is missing or malformed.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.missingBody"))
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJson"))
		return false
	}
	return true
}

// queryInt extracts an integer query parameter with a fallback default.
// Uses strconv.Atoi for robust parsing that handles negative numbers
// and overflow correctly, falling back to the default on any error.
func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// queryString extracts a string query parameter with a fallback.
func queryString(r *http.Request, key, def string) string {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	return v
}
