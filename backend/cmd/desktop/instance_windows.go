//go:build windows

package main

import (
	"encoding/json"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Wails signals a running instance through a WM_COPYDATA message aimed at a
// hidden message-only window it registers under a class/name pair derived from
// the SingleInstanceLock id. Re-creating that handshake here means a second
// launch can still raise the existing window before exiting, which the early
// startup lock would otherwise swallow.
const (
	wmCopyData       = 0x004A
	wailsCopyDataTag = 1542
)

type copyDataStruct struct {
	dwData uintptr
	cbData uint32
	lpData uintptr
}

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	procFindWindowW  = user32.NewProc("FindWindowW")
	procSendMessageW = user32.NewProc("SendMessageW")
)

// focusExistingInstance asks the already-running instance to raise its window.
// It returns false when the primary window cannot be located, for instance
// when it is still starting up; the caller treats that as non-fatal.
func focusExistingInstance(uniqueID string) bool {
	className, err1 := syscall.UTF16PtrFromString("wails-app-" + uniqueID + "-sic")
	windowName, err2 := syscall.UTF16PtrFromString("wails-app-" + uniqueID + "-siw")
	if err1 != nil || err2 != nil {
		return false
	}

	hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(windowName)))
	if hwnd == 0 {
		return false
	}

	payload := marshalSecondInstanceData()

	cds := copyDataStruct{
		dwData: wailsCopyDataTag,
		cbData: uint32(len(payload)*2 + 1),
		lpData: uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(payload))),
	}

	procSendMessageW.Call(hwnd, wmCopyData, 0, uintptr(unsafe.Pointer(&cds)))
	return true
}

func marshalSecondInstanceData() string {
	data := struct {
		Args             []string `json:"Args"`
		WorkingDirectory string   `json:"WorkingDirectory"`
	}{
		Args: os.Args[1:],
	}
	if cwd, err := os.Getwd(); err == nil {
		data.WorkingDirectory = cwd
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// earlyInstanceLock is a named mutex claimed before the application is
// initialized. Wails' own SingleInstanceLock is only claimed once wails.Run
// starts, which is far too late: a second launch would already have opened the
// SQLite file, run migrations, started the scheduler scan timer and the
// backpressure monitor before being told to exit. Claiming the mutex first
// turns "double open" into an immediate no-op.
//
// The mutex name intentionally differs from Wails' ("wails-app-<id>-sim"); this
// one guards startup, that one guards the window handshake.
func earlyInstanceLock(name string) (release func(), acquired bool) {
	handle, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(name))

	// ERROR_ALREADY_EXISTS is reported through err, so it must be checked
	// before the generic failure branch: another instance holds the lock.
	if err == windows.ERROR_ALREADY_EXISTS {
		_ = windows.CloseHandle(handle)
		return func() {}, false
	}
	if err != nil {
		// Any other failure means the lock state is unknown, not that another
		// instance exists. Start anyway and let the Wails-level lock make the
		// final call rather than refusing to launch on a false positive.
		return func() {}, true
	}
	return func() { _ = windows.CloseHandle(handle) }, true
}
