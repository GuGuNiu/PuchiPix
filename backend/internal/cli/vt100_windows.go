//go:build windows

package cli

import (
	"os"

	"golang.org/x/sys/windows"
)

// EnableVT100 enables virtual terminal processing on the Windows console
// so ANSI escape sequences render as colors instead of raw text.
func EnableVT100() {
	var mode uint32
	stdout := windows.Handle(os.Stdout.Fd())
	if err := windows.GetConsoleMode(stdout, &mode); err != nil {
		return
	}
	mode |= windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING
	_ = windows.SetConsoleMode(stdout, mode)
}
