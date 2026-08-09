// Package xutil provides small shared helpers that were previously
// duplicated across site providers and the orchestrator, such as
// slice de-duplication. Keeping them in a single package gives the
// codebase one source of truth.
package xutil

// UniqueStrings returns a new slice with duplicate strings removed,
// preserving first-occurrence order. Empty strings are kept only if
// includeEmpty is true; most callers pass false to filter them out.
func UniqueStrings(input []string, includeEmpty bool) []string {
	if len(input) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(input))
	var result []string
	for _, s := range input {
		if !includeEmpty && s == "" {
			continue
		}
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}
