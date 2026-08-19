package response

import (
	"encoding/json"
	"net/http"
	"strconv"

	"backend/internal/i18n"
)

// WriteJSON encodes data as JSON and writes it with the given status.
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

// WriteError sends a uniform error envelope matching the Next.js
// `{ error: string }` contract. All error responses use this to
// maintain a consistent structure across the API.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}

// DecodeJSON decodes the request body into dst, returning false and
// writing a 400 error if the body is missing or malformed.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil {
		WriteError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.missingBody"))
		return false
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		WriteError(w, http.StatusBadRequest, i18n.TFromRequest(r, "api.common.invalidJson"))
		return false
	}
	return true
}

// QueryInt extracts an integer query parameter with a fallback default.
// Uses strconv.Atoi for robust parsing that handles negative numbers
// and overflow correctly, falling back to the default on any error.
func QueryInt(r *http.Request, key string, def int) int {
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
