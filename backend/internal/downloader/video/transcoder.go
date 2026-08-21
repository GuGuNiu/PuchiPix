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

type TranscodeOptions struct {
	UseGPU bool
	ForceGPUType string
}

func TranscodeTS(ctx context.Context, inputDir, outputPath string, opts ...TranscodeOptions) error {
	dirPath := filepath.Clean(inputDir)

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

	// Determine transcoding strategy: GPU HW accel vs stream copy
	var args []string
	opt := TranscodeOptions{}
	if len(opts) > 0 {
		opt = opts[0]
	}

	if opt.UseGPU {
		args = buildHWAccelArgs(concatResolved, outputResolved, opt.ForceGPUType)
	} else {
		args = []string{
			"-f", "concat",
			"-safe", "0",
			"-i", concatResolved,
			"-c", "copy",
			"-bsf:a", "aac_adtstoasc",
			"-y",
			outputResolved,
		}
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

// buildHWAccelArgs constructs ffmpeg arguments for hardware-accelerated
// transcoding. Falls back to stream copy if no suitable GPU is found.
func buildHWAccelArgs(concatPath, outputPath, forceGPUType string) []string {
	gpuInfo := DetectGPU()

	if forceGPUType != "" {
		forcedType := GPUType(forceGPUType)
		if gpuInfo.Type == forcedType && gpuInfo.Available {
			return buildHWArgsForType(gpuInfo, concatPath, outputPath)
		}
		return buildForcedHWArgs(forcedType, concatPath, outputPath)
	}

	if gpuInfo.SupportsHWTranscode() {
		return buildHWArgsForType(gpuInfo, concatPath, outputPath)
	}

	return []string{
		"-f", "concat",
		"-safe", "0",
		"-i", concatPath,
		"-c", "copy",
		"-bsf:a", "aac_adtstoasc",
		"-y",
		outputPath,
	}
}

// TranscodeTSWithFallback attempts GPU transcoding first, then falls back to
// CPU stream copy on failure. Returns an error only if both methods fail.
func TranscodeTSWithFallback(ctx context.Context, inputDir, outputPath string, opts TranscodeOptions) error {
	if !opts.UseGPU {
		return TranscodeTS(ctx, inputDir, outputPath, opts)
	}

	gpuErr := TranscodeTS(ctx, inputDir, outputPath, opts)
	if gpuErr == nil {
		return nil
	}

	fallbackOpts := TranscodeOptions{UseGPU: false}
	fallbackErr := transcodeCopyDirect(ctx, inputDir, outputPath, fallbackOpts)
	if fallbackErr == nil {
		return nil
	}

	return fmt.Errorf("GPU transcoding failed (%v) and CPU fallback also failed (%v)", gpuErr, fallbackErr)
}

// transcodeCopyDirect performs a direct stream copy without GPU options.
func transcodeCopyDirect(ctx context.Context, inputDir, outputPath string, opts TranscodeOptions) error {
	// Reuse TranscodeTS with UseGPU=false
	return TranscodeTS(ctx, inputDir, outputPath, TranscodeOptions{UseGPU: false})
}

// buildHWArgsForType builds ffmpeg args for a detected GPU type. Input-side
// options (e.g. -hwaccel) must precede -i; output-side options (e.g. -c:v)
// must follow -i but precede the output path. Swapping the order causes
// ffmpeg to reject the command with an input/output option mismatch error.
func buildHWArgsForType(gpu *GPUInfo, concatPath, outputPath string) []string {
	inputArgs := gpu.GetHWInputArgs()
	outputArgs := gpu.GetHWOutputArgs()

	args := make([]string, 0, len(inputArgs)+len(outputArgs)+6)
	args = append(args, inputArgs...)
	args = append(args,
		"-f", "concat",
		"-safe", "0",
		"-i", concatPath,
	)
	args = append(args, outputArgs...)
	args = append(args, "-y", outputPath)

	return args
}

// buildForcedHWArgs builds ffmpeg args for a user-specified GPU encoder type
// that may not have been auto-detected.
func buildForcedHWArgs(forceType GPUType, concatPath, outputPath string) []string {
	tempInfo := &GPUInfo{Type: forceType, Available: true}
	switch forceType {
	case GPUTypeNVENC:
		tempInfo.EncoderName = "h264_nvenc"
	case GPUTypeQSV:
		tempInfo.EncoderName = "h264_qsv"
	case GPUTypeVAAPI:
		tempInfo.EncoderName = "h264_vaapi"
	case GPUTypeAMF:
		tempInfo.EncoderName = "h264_amf"
	case GPUTypeVideotoolbox:
		tempInfo.EncoderName = "h264_videotoolbox"
	default:
		return []string{
			"-f", "concat", "-safe", "0",
			"-i", concatPath,
			"-c", "copy", "-bsf:a", "aac_adtstoasc",
			"-y", outputPath,
		}
	}
	return buildHWArgsForType(tempInfo, concatPath, outputPath)
}
