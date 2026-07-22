package ui

import (
	"fmt"
	"time"
)

// FormatTime formats an ISO timestamp as HH:MM:SS, matching the
// TypeScript formatTime function.
func FormatTime(iso string) string {
	t := parseTime(iso)
	return t.Format("15:04:05")
}

// FormatDateTime formats an ISO timestamp as MM-DD HH:MM:SS, matching
// the TypeScript formatDateTime function.
func FormatDateTime(iso string) string {
	t := parseTime(iso)
	return t.Format("01-02 15:04:05")
}

// Truncate shortens a string to max length, appending an ellipsis
// if truncation occurred.
func Truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max <= 1 {
		return "\u2026"
	}
	return s[:max-1] + "\u2026"
}

// FormatDuration converts milliseconds to a human-readable duration
// string, matching the TypeScript formatDuration function.
func FormatDuration(ms int64) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	if ms < 60000 {
		return fmt.Sprintf("%.1fs", float64(ms)/1000)
	}
	if ms < 3600000 {
		return fmt.Sprintf("%.1fm", float64(ms)/60000)
	}
	return fmt.Sprintf("%.1fh", float64(ms)/3600000)
}

// DurationBetween returns the millisecond difference between two ISO
// timestamps.
func DurationBetween(startISO, endISO string) int64 {
	start := parseTime(startISO)
	end := parseTime(endISO)
	return end.Sub(start).Milliseconds()
}

func parseTime(iso string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.000"} {
		if t, err := time.Parse(layout, iso); err == nil {
			return t
		}
	}
	return time.Time{}
}
