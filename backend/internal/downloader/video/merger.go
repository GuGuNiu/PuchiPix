package video

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"backend/internal/infra"
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
	return MergeSegmentsContext(context.Background(), segDir, outputPath, manifest)
}

func MergeSegmentsContext(ctx context.Context, segDir, outputPath string, manifest []string) (*MergeResult, error) {
	return mergeSegmentsContext(ctx, segDir, outputPath, manifest, nil)
}

func MergeSegmentsContextWithProgress(ctx context.Context, segDir, outputPath string, manifest []string, onProgress func(completed, total int)) (*MergeResult, error) {
	return mergeSegmentsContext(ctx, segDir, outputPath, manifest, onProgress)
}

func mergeSegmentsContext(ctx context.Context, segDir, outputPath string, manifest []string, onProgress func(completed, total int)) (*MergeResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(manifest) == 0 {
		return nil, errors.New("merge manifest is empty")
	}
	dirPath := filepath.Clean(segDir)

	files := make([]string, 0, len(manifest))
	for _, name := range manifest {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		info, err := os.Stat(filepath.Join(dirPath, name))
		if err != nil || info.Size() == 0 {
			continue
		}
		files = append(files, name)
	}

	if len(files) == 0 {
		return nil, errors.New("no .ts segment files found to merge")
	}

	outputDir := filepath.Dir(outputPath)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}

	out, err := os.CreateTemp(outputDir, "."+filepath.Base(outputPath)+".*.tmp")
	if err != nil {
		return nil, err
	}
	tempPath := out.Name()
	defer func() {
		_ = out.Close()
		_ = os.Remove(tempPath)
	}()

	writer := bufio.NewWriterSize(out, 256*1024)
	copyBuffer := make([]byte, 256*1024)
	var totalSize int64
	total := len(manifest)
	if onProgress != nil {
		onProgress(0, total)
	}
	for i, file := range files {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		src, err := os.Open(filepath.Join(dirPath, file))
		if err != nil {
			return nil, fmt.Errorf("cannot open segment %s: %w", file, err)
		}
		written, copyErr := io.CopyBuffer(&infra.CountingWriter{W: writer}, &mergeContextReader{ctx: ctx, reader: src}, copyBuffer)
		closeErr := src.Close()
		if copyErr != nil {
			return nil, fmt.Errorf("cannot copy segment %s: %w", file, copyErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("cannot close segment %s: %w", file, closeErr)
		}
		totalSize += written
		if onProgress != nil {
			onProgress(i+1, total)
		}
	}

	if err := writer.Flush(); err != nil {
		return nil, fmt.Errorf("cannot flush merged output: %w", err)
	}
	if err := out.Close(); err != nil {
		return nil, fmt.Errorf("cannot close merged output: %w", err)
	}

	if err := os.Rename(tempPath, outputPath); err != nil {
		removeErr := os.Remove(outputPath)
		if removeErr != nil && !os.IsNotExist(removeErr) {
			return nil, fmt.Errorf("cannot replace merged output: %w", err)
		}
		if err := os.Rename(tempPath, outputPath); err != nil {
			return nil, fmt.Errorf("cannot publish merged output: %w", err)
		}
	}

	return &MergeResult{
		TotalFiles: len(files),
		TotalSize:  totalSize,
	}, nil
}

type mergeContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *mergeContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
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
