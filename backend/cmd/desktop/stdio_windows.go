//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

// consoleAttached reports whether the process has a usable console behind
// stdout. A windowsgui-subsystem exe launched from Explorer or the Start menu
// has no console at all (invalid std handles), while a go run from a terminal
// does — that is the line between "developer wants console output" and
// "double-clicked from the shell". A redirected pipe is treated as no console:
// redirecting the packaged exe's stdout is not a supported workflow, and the
// on-disk log is where output belongs either way.
func consoleAttached() bool {
	h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE)
	if err != nil || h == 0 || h == windows.InvalidHandle {
		return false
	}
	var mode uint32
	return windows.GetConsoleMode(h, &mode) == nil
}

// redirectStdio points the process std handles at logPath. Reassigning
// os.Stdout/os.Stderr covers fmt and the infra logger; SetStdHandle additionally
// rewrites the process-level handles the Go runtime consults when it emits
// panic output, so a crash leaves a stack trace in the log instead of
// vanishing with the invisible console.
func redirectStdio(logPath string) error {
	if consoleAttached() {
		return nil
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	h := windows.Handle(f.Fd())
	_ = windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, h)
	_ = windows.SetStdHandle(windows.STD_ERROR_HANDLE, h)
	os.Stdout = f
	os.Stderr = f
	return nil
}
