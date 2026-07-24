package video

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var ffmpegPath = "ffmpeg"

// SetFFmpegPath overrides the default ffmpeg binary path, useful when
// ffmpeg is not on the system PATH or a specific version is required.
func SetFFmpegPath(p string) {
	ffmpegPath = p
}

// CheckFFmpeg verifies that the ffmpeg binary is reachable and can
// report its version, preventing silent failures during transcoding.
func CheckFFmpeg() bool {
	cmd := exec.Command(ffmpegPath, "-version")
	return cmd.Run() == nil
}

// TranscodeTS converts .ts segments in inputDir into a single MP4 file
// using ffmpeg's concat demuxer with stream copy, avoiding re-encoding
// for maximum speed. A temporary concat list file is generated and
// cleaned up after the operation completes.
func TranscodeTS(ctx context.Context, inputDir, outputPath string) error {
	dirPath := filepath.Clean(inputDir)

	// Resolve to absolute path so that ffmpeg's concat demuxer can find
	// the segment files regardless of the working directory. Without this,
	// relative paths in concat.txt are resolved relative to the concat
	// file's own directory, causing doubled paths.
	absDir, err := filepath.Abs(dirPath)
	if err != nil {
		absDir = dirPath
	}

	entries, err := os.ReadDir(absDir)
	if err != nil {
		return fmt.Errorf("cannot read segment directory: %w", err)
	}

	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tmp") {
			files = append(files, name)
		}
	}

	if len(files) == 0 {
		return fmt.Errorf("no .ts segment files found for transcoding")
	}

	sort.Slice(files, func(i, j int) bool {
		return extractSegmentIndex(files[i]) < extractSegmentIndex(files[j])
	})

	concatPath := filepath.Join(absDir, "concat.txt")
	var buf bytes.Buffer
	for _, file := range files {
		full := filepath.Join(absDir, file)
		buf.WriteString("file '")
		buf.WriteString(strings.ReplaceAll(full, "\\", "/"))
		buf.WriteString("'\n")
	}
	if err := os.WriteFile(concatPath, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("cannot write concat list: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		os.Remove(concatPath)
		return err
	}

	outputResolved, err := filepath.Abs(outputPath)
	if err != nil {
		outputResolved = outputPath
	}
	concatResolved, err := filepath.Abs(concatPath)
	if err != nil {
		concatResolved = concatPath
	}

	args := []string{
		"-f", "concat",
		"-safe", "0",
		"-i", concatResolved,
		"-c", "copy",
		"-bsf:a", "aac_adtstoasc",
		"-y",
		outputResolved,
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		os.Remove(concatPath)
		tail := stderr.String()
		if len(tail) > 500 {
			tail = tail[len(tail)-500:]
		}
		return fmt.Errorf("ffmpeg exited with error: %w: %s", err, tail)
	}

	os.Remove(concatPath)
	return nil
}

var (
	durationRe   = regexp.MustCompile(`Duration:\s*(\d+):(\d+):(\d+)\.(\d+)`)
	resolutionRe = regexp.MustCompile(`(\d{2,4}x\d{2,4})`)
)

// ProbeDuration extracts the video duration in seconds from ffmpeg's
// stderr output, returning 0 when the duration line is absent.
func ProbeDuration(ctx context.Context, filePath string) (float64, error) {
	output, err := runFFmpegProbe(ctx, filePath)
	if err != nil {
		return 0, nil
	}

	match := durationRe.FindStringSubmatch(output)
	if match == nil {
		return 0, nil
	}

	hours := parseIntSafe(match[1])
	minutes := parseIntSafe(match[2])
	seconds := parseIntSafe(match[3])
	ms := parseIntSafe(match[4])

	return float64(hours*3600+minutes*60+seconds) + float64(ms)/100.0, nil
}

// ProbeResolution extracts the video resolution string (e.g. "1920x1080")
// from ffmpeg's stderr output, returning an empty string when absent.
func ProbeResolution(ctx context.Context, filePath string) (string, error) {
	output, err := runFFmpegProbe(ctx, filePath)
	if err != nil {
		return "", nil
	}

	match := resolutionRe.FindStringSubmatch(output)
	if match == nil {
		return "", nil
	}
	return match[1], nil
}

func runFFmpegProbe(ctx context.Context, filePath string) (string, error) {
	cmd := exec.CommandContext(ctx, ffmpegPath, "-i", filePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	_ = cmd.Run()
	return stderr.String(), nil
}

func parseIntSafe(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}
