//go:build !windows

package main

// earlyInstanceLock is a no-op outside Windows: the desktop shell targets
// Windows, and Wails' own SingleInstanceLock still applies on other platforms.
func earlyInstanceLock(string) (func(), bool) {
	return func() {}, true
}

func focusExistingInstance(string) bool { return false }
