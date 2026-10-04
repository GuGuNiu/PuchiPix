//go:build !windows

package main

import "os"

// redirectStdio mirrors the Windows build: when there is no terminal attached
// the file is the only sensible destination. Non-Windows desktop builds are
// not a supported target; this exists so the package still compiles.
func redirectStdio(logPath string) error {
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	os.Stdout = f
	os.Stderr = f
	return nil
}
