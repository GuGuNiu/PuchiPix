package api

import (
	"net/http"

	"backend/internal/api/internal/response"
)

func writeJSON(w http.ResponseWriter, status int, data any) {
	response.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	response.WriteError(w, status, message)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	return response.DecodeJSON(w, r, dst)
}

func queryInt(r *http.Request, key string, def int) int {
	return response.QueryInt(r, key, def)
}
