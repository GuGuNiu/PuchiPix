package api

import (
	"os"
	"time"

	"backend/internal/infra"
)

// cleanupLogger is a package-level logger for background file cleanup.
var cleanupLogger = infra.NewLogger("Cleanup")

// asyncRemoveAll removes the given paths (files or directory trees) in a
// background goroutine so DELETE handlers can respond immediately instead of
// blocking on slow or locked file I/O (Windows: files may still be held open
// by in-flight download/merge executors right after CancelDag).
//
// Retry policy: up to 5 attempts, 2s apart. This rides out the window where
// a just-cancelled executor still holds file handles; after the final attempt
// any survivors are logged (never silently swallowed) so orphaned leftovers
// remain visible and diagnosable.
//
// Motivation (2026-09-05 batch-delete stall): synchronous os.RemoveAll inside
// ShelfDelete/TaskDelete blocked responses on locked files, and errors were
// discarded with `_ =`, leaving half-deleted folders with no trace in logs.
func asyncRemoveAll(paths ...string) {
	go func() {
		const attempts = 5
		const interval = 2 * time.Second

		pending := make([]string, 0, len(paths))
		for _, p := range paths {
			if p != "" {
				pending = append(pending, p)
			}
		}
		if len(pending) == 0 {
			return
		}

		for i := 1; i <= attempts; i++ {
			remaining := pending[:0]
			for _, p := range pending {
				if err := os.RemoveAll(p); err != nil {
					remaining = append(remaining, p)
					if i == attempts {
						cleanupLogger.Error("Background cleanup failed after retries",
							"path", p,
							"attempts", attempts,
							"error", err.Error())
					}
				}
			}
			if len(remaining) == 0 {
				return
			}
			pending = remaining
			if i < attempts {
				time.Sleep(interval)
			}
		}
	}()
}
