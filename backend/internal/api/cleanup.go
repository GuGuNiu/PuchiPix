package api

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"backend/internal/infra"
)

var cleanupLogger = infra.NewLogger("Cleanup")

func resolveExistingPath(path string) (string, error) {
	current := filepath.Clean(path)
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return filepath.Clean(resolved), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}

func containedPath(root, target string, allowRoot bool) (string, error) {
	if root == "" || target == "" {
		return "", fmt.Errorf("empty deletion root or target")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	resolvedRoot, err := resolveExistingPath(absRoot)
	if err != nil {
		return "", err
	}
	resolvedTarget, err := resolveExistingPath(absTarget)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil {
		return "", err
	}
	if rel == "." {
		if allowRoot {
			return absTarget, nil
		}
		return "", fmt.Errorf("deletion target %q is the root %q", absTarget, absRoot)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("deletion target %q is outside root %q", absTarget, absRoot)
	}
	return absTarget, nil
}

func (h *Handlers) dataRoot() string {
	if h.DataDir != "" {
		return h.DataDir
	}
	if h.DownloadMgr != nil {
		return h.DownloadMgr.DataRoot()
	}
	return ""
}

func (h *Handlers) validateDataPath(rootDir, target string, allowRoot bool) (string, error) {
	dataDir := h.dataRoot()
	if dataDir == "" {
		return "", fmt.Errorf("data directory is not configured")
	}
	if !filepath.IsAbs(target) {
		if strings.EqualFold(filepath.Base(dataDir), "data") && (target == "data" || strings.HasPrefix(target, "data"+string(filepath.Separator))) {
			target = filepath.Join(filepath.Dir(dataDir), target)
		} else {
			target = filepath.Join(dataDir, target)
		}
	}
	return containedPath(filepath.Join(dataDir, rootDir), target, allowRoot)
}

func removeAllSync(ctx context.Context, paths ...string) error {
	pending := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		clean := filepath.Clean(path)
		key := clean
		if resolved, err := resolveExistingPath(clean); err == nil {
			key = resolved
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		pending = append(pending, clean)
	}
	if len(pending) == 0 {
		return nil
	}

	const attempts = 5
	const interval = time.Second
	var lastErr error
	var lastPath string

	for attempt := 1; attempt <= attempts; attempt++ {
		remaining := pending[:0]
		for _, path := range pending {
			if err := os.RemoveAll(path); err != nil {
				remaining = append(remaining, path)
				lastErr = err
				lastPath = path
			}
		}
		if len(remaining) == 0 {
			return nil
		}
		pending = remaining
		if attempt < attempts {
			timer := time.NewTimer(interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return fmt.Errorf("remove cache path %s: %w", lastPath, ctx.Err())
			case <-timer.C:
			}
		}
	}

	return fmt.Errorf("remove cache path %s: %w", lastPath, lastErr)
}
