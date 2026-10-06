//go:build !windows

package video

import "os/exec"

// hideConsoleWindow is a no-op off Windows: flashing console windows are a
// Windows allocation behavior, and POSIX children simply inherit the
// parent's stdio.
func hideConsoleWindow(_ *exec.Cmd) {}
