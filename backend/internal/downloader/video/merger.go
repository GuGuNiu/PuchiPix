package video

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var segmentIdxRe = regexp.MustCompile(`_(\d+)\.ts$`)

// MergeResult reports the outcome of a segment merge operation.
type MergeResult struct {
	TotalFiles int
	TotalSize  int64
}

// MergeSegments concatenates all .ts segment files in segDir into a
// single output file, sorted by their index suffix to preserve
// playback order. Empty files abort the merge to prevent corruption.
func MergeSegments(segDir, outputPath string) (*MergeResult, error) {
	dirPath := filepath.Clean(segDir)

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("segment directory does not exist: %s", dirPath)
	}

	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tmp") {
			files = append(files, name)
		}
	}

	if len(files) == 0 {
		return nil, errors.New("no .ts segment files found to merge")
	}

	sort.Slice(files, func(i, j int) bool {
		return extractSegmentIndex(files[i]) < extractSegmentIndex(files[j])
	})

	for _, file := range files {
		info, err := os.Stat(filepath.Join(dirPath, file))
		if err != nil {
			return nil, fmt.Errorf("cannot stat segment %s: %w", file, err)
		}
		if info.Size() == 0 {
			return nil, fmt.Errorf("segment file is empty (0 bytes): %s", file)
		}
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return nil, err
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return nil, err
	}
	defer out.Close()

	var totalSize int64
	for _, file := range files {
		data, err := os.ReadFile(filepath.Join(dirPath, file))
		if err != nil {
			return nil, fmt.Errorf("cannot read segment %s: %w", file, err)
		}
		written, err := out.Write(data)
		if err != nil {
			return nil, fmt.Errorf("cannot write segment %s: %w", file, err)
		}
		totalSize += int64(written)
	}

	return &MergeResult{
		TotalFiles: len(files),
		TotalSize:  totalSize,
	}, nil
}

// SegmentVerification holds the result of checking whether all expected
// segments are present and non-empty on disk.
type SegmentVerification struct {
	Valid        bool
	Missing      []int
	EmptyFiles   []string
	TotalSize    int64
	ActualCount  int
}

// VerifySegments checks that exactly expectedCount segments exist in
// segDir, none are empty, and reports any missing indices so the
// caller can decide whether to retry or fail.
func VerifySegments(segDir string, expectedCount int) SegmentVerification {
	dirPath := filepath.Clean(segDir)

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		missing := make([]int, expectedCount)
		for i := range missing {
			missing[i] = i
		}
		return SegmentVerification{
			Valid:       false,
			Missing:     missing,
			ActualCount: 0,
		}
	}

	foundIndices := make(map[int]bool)
	var emptyFiles []string
	var totalSize int64
	var actualCount int

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tmp") {
			continue
		}

		match := segmentIdxRe.FindStringSubmatch(name)
		if match == nil {
			continue
		}

		idx := parseSegmentIndex(match[1])
		foundIndices[idx] = true
		actualCount++

		fullPath := filepath.Join(dirPath, name)
		info, err := os.Stat(fullPath)
		if err != nil {
			continue
		}
		totalSize += info.Size()
		if info.Size() == 0 {
			emptyFiles = append(emptyFiles, name)
		}
	}

	var missing []int
	for i := 0; i < expectedCount; i++ {
		if !foundIndices[i] {
			missing = append(missing, i)
		}
	}

	return SegmentVerification{
		Valid:       len(missing) == 0 && len(emptyFiles) == 0,
		Missing:     missing,
		EmptyFiles:  emptyFiles,
		TotalSize:   totalSize,
		ActualCount: actualCount,
	}
}

// CleanupSegments removes a segment directory and all its contents,
// swallowing errors because it is called as best-effort cleanup
// after a download completes or fails.
func CleanupSegments(segDir string) error {
	return os.RemoveAll(segDir)
}

func extractSegmentIndex(filename string) int {
	match := segmentIdxRe.FindStringSubmatch(filename)
	if match == nil {
		return 0
	}
	return parseSegmentIndex(match[1])
}

func parseSegmentIndex(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}
