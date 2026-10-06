package video

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SweepOrphanTempFiles removes abandoned transcode/merge scratch files from
// a video output directory. Both producers write their scratch output as a
// dot-prefixed sibling of the final file — ".<name>.mp4-<rand>.mp4" from
// the transcoder and ".<name>.mp4.<rand>.tmp" from the merger — and delete
// it via defer on every in-process exit path. A SIGKILL-style termination
// (taskkill, power loss) never runs the defer, leaking a partial file that
// can reach gigabytes and never carries a moov atom. Final outputs never
// start with a dot, so the prefix is an unambiguous orphan marker.
//
// minAge bounds deletion to files whose last write is older than the given
// duration: ffmpeg and the merge writer touch their output continuously
// while running, so a live temp file always has a fresh mtime and a sweep
// racing an in-flight transcode cannot remove it. Returns the removed file
// names and the total bytes reclaimed.
func SweepOrphanTempFiles(dir string, minAge time.Duration) ([]string, int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, nil
		}
		return nil, 0, err
	}

	cutoff := time.Now().Add(-minAge)
	var removed []string
	var reclaimed int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, ".") {
			continue
		}
		if ext := filepath.Ext(name); ext != ".mp4" && ext != ".tmp" {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return removed, reclaimed, fmt.Errorf("remove orphan temp %s: %w", name, err)
		}
		removed = append(removed, name)
		reclaimed += info.Size()
	}
	return removed, reclaimed, nil
}
