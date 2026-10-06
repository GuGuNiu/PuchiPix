//go:build windows

package video

import (
	"os/exec"
	"syscall"
)

// createNoWindow is the Windows CREATE_NO_WINDOW process-creation flag: the
// child is born without a console at all. Paired with HideWindow
// (STARTF_USESHOWWINDOW / SW_HIDE) so neither a console-subsystem child nor
// its conhost can ever surface a window.
const createNoWindow = 0x08000000

// hideConsoleWindow marks cmd as a background child. The Wails shell is a
// windowsgui-subsystem binary with no console of its own; without this, every
// nvidia-smi / ffmpeg invocation — both console-subsystem executables —
// allocates a visible CMD window that flashes next to the app at startup
// (GPU + encoder probes) and again during merge/transcode phases.
func hideConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
