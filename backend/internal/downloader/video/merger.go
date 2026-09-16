package video

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var segmentIdxRe = regexp.MustCompile(`_(\d+)\.ts$`)

// playlistFingerprintFile stores the M3U8 playlist fingerprint inside the
// segment directory so a task retry can detect playlist changes.
const playlistFingerprintFile = ".m3u8-fingerprint"

// mergedOutputDir is the subdirectory (inside the segment directory) where
// intermediate merge outputs are written. Scan-based consumers only look at
// *.ts files in the segment directory root, so the merged output must NOT
// live there — otherwise the next directory scan swallows it into the input
// set and the output doubles on every retry round.
const mergedOutputDir = "_merged"

// SegmentFileName returns the canonical on-disk file name for a segment.
// Both the primary download path (SegmentQueue) and the retry path
// (DownloadSegmentsBatch) must use this identity so a re-downloaded
// segment overwrites its stale copy instead of coexisting under a
// second name and being merged twice.
func SegmentFileName(seg M3U8Segment) string {
	return GenerateTSID(seg.URI, seg.Index) + ".ts"
}

// SegmentManifest builds the ordered list of canonical segment file names
// for a playlist. The manifest is the single source of truth for merge
// and transcode inputs — never a directory scan.
func SegmentManifest(segments []M3U8Segment) []string {
	files := make([]string, len(segments))
	for i, seg := range segments {
		files[i] = SegmentFileName(seg)
	}
	return files
}

// PlaylistFingerprint returns a stable digest of the playlist identity
// (segment URIs). A change means the source switched variants or was
// re-sliced, so cached segments are no longer valid merge inputs.
func PlaylistFingerprint(segments []M3U8Segment) string {
	h := sha256.New()
	for _, seg := range segments {
		h.Write([]byte(seg.FullURI))
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// EnsurePlaylistFingerprint validates the playlist fingerprint against the
// one recorded in segDir. On mismatch it wipes the cached .ts segments (and
// the merged-output cache) and reports the reset so the caller can log it.
// The current fingerprint is then persisted for the next run.
func EnsurePlaylistFingerprint(segDir string, segments []M3U8Segment) (reset bool) {
	fpPath := filepath.Join(segDir, playlistFingerprintFile)
	fp := PlaylistFingerprint(segments)

	if stored, err := os.ReadFile(fpPath); err == nil && string(stored) != fp {
		cleanupAllSegments(segDir)
		_ = os.RemoveAll(filepath.Join(segDir, mergedOutputDir))
		reset = true
	}

	_ = os.WriteFile(fpPath, []byte(fp), 0644)
	return reset
}

// MergeResult reports the outcome of a segment merge operation.
type MergeResult struct {
	TotalFiles int
	TotalSize  int64
}

// MergeSegments concatenates the manifest-listed .ts segment files (in the
// given playlist order) into a single output file. Files in segDir that are
// not part of the manifest — stale merged outputs, foreign-variant residue,
// duplicate-named copies — are ignored. Missing or empty manifest entries
// are skipped; the caller's validation detects them and triggers a
// targeted redownload.
func MergeSegments(segDir, outputPath string, manifest []string) (*MergeResult, error) {
	if len(manifest) == 0 {
		return nil, errors.New("merge manifest is empty")
	}
	dirPath := filepath.Clean(segDir)

	files := make([]string, 0, len(manifest))
	for _, name := range manifest {
		info, err := os.Stat(filepath.Join(dirPath, name))
		if err != nil || info.Size() == 0 {
			continue
		}
		files = append(files, name)
	}

	if len(files) == 0 {
		return nil, errors.New("no .ts segment files found to merge")
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
