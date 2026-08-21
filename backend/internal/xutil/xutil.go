// Package xutil provides small shared helpers used across site providers
// and the orchestrator.
package xutil

// UniqueStrings returns a new slice with duplicate strings removed,
// preserving first-occurrence order.
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
