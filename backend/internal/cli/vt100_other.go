//go:build !windows

package cli

// EnableVT100 is a no-op on non-Windows platforms where ANSI escape
// sequences are supported natively by the terminal.
func EnableVT100() {}
