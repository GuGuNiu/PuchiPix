package video

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var ffmpegPath = "ffmpeg"

type TranscodeOptions struct {
	UseGPU bool
	ForceGPUType string
	// OnProgress receives the transcoding progress as a 0-100 percentage,
	// parsed from ffmpeg's `-progress pipe:1` machine-readable output.
	// It is invoked from a background reader goroutine, so the callback
	// must be cheap and goroutine-safe. Nil disables progress reporting
	// entirely (no -progress args are added, stdout behavior unchanged).
	OnProgress func(percent float64)
}

// TranscodeTS concatenates TS segments and transcodes them into outputPath.
// When manifest is non-empty it is the ordered list of segment file names to
// feed ffmpeg — this is the authoritative input set, so stray .ts files in
// inputDir (stale merge outputs, foreign-variant residue) are ignored. A nil
// manifest falls back to a directory scan (legacy callers only).
func TranscodeTS(ctx context.Context, inputDir, outputPath string, manifest []string, opts ...TranscodeOptions) error {
	dirPath := filepath.Clean(inputDir)

	absDir, err := filepath.Abs(dirPath)
	if err != nil {
		absDir = dirPath
	}

	var files []string
	if len(manifest) > 0 {
		// Manifest order is playlist order — never re-sorted. Missing or
		// empty entries are skipped (callers tolerate partial downloads
		// within the failure threshold); an empty usable set is an error.
		for _, name := range manifest {
			info, statErr := os.Stat(filepath.Join(absDir, name))
			if statErr != nil || info.Size() == 0 {
				continue
			}
			files = append(files, name)
		}
	} else {
		entries, err := os.ReadDir(absDir)
		if err != nil {
			return fmt.Errorf("cannot read segment directory: %w", err)
		}

		for _, entry := range entries {
			name := entry.Name()
			if strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tmp") {
				files = append(files, name)
			}
		}

		sort.Slice(files, func(i, j int) bool {
			return extractSegmentIndex(files[i]) < extractSegmentIndex(files[j])
		})
	}

	if len(files) == 0 {
		return fmt.Errorf("no .ts segment files found for transcoding")
	}

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

	// `-progress` / `-nostats` are global ffmpeg options (position
	// independent), prepended ahead of any input-side hwaccel args.
	if opt.OnProgress != nil {
		args = append([]string{"-progress", "pipe:1", "-nostats"}, args...)
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var runErr error
	var stderrTail func() string
	if opt.OnProgress != nil {
		capture := &durationCapture{}
		cmd.Stderr = capture
		stderrTail = capture.String
		runErr = runWithProgress(cmd, capture, opt.OnProgress)
	} else {
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		stderrTail = stderr.String
		runErr = cmd.Run()
	}

	if runErr != nil {
		os.Remove(concatPath)
		tail := stderrTail()
		if len(tail) > 500 {
			tail = tail[len(tail)-500:]
		}
		return fmt.Errorf("ffmpeg exited with error: %w: %s", runErr, tail)
	}

	os.Remove(concatPath)
	return nil
}

// outTimeRe matches the `out_time=H:MM:SS.micros` key of ffmpeg's
// `-progress pipe:1` machine-readable output.
var outTimeRe = regexp.MustCompile(`^out_time=(\d+):(\d{2}):(\d{2})\.(\d+)`)

// durationCapture wraps the ffmpeg stderr buffer and scrapes the input
// header's "Duration: HH:MM:SS.ms" line (printed before any transcoding
// output starts) to establish the 100% reference for progress math.
// Writes arrive on exec's internal copy goroutine while Total is read
// from the stdout parser goroutine, so access is mutex-guarded.
type durationCapture struct {
	mu    sync.Mutex
	buf   bytes.Buffer
	line  []byte
	total float64
}

func (d *durationCapture) Write(p []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, b := range p {
		if b == '\n' || b == '\r' {
			if m := durationRe.FindStringSubmatch(string(d.line)); m != nil && d.total == 0 {
				d.total = float64(parseIntSafe(m[1]))*3600 +
					float64(parseIntSafe(m[2]))*60 +
					float64(parseIntSafe(m[3])) +
					float64(parseIntSafe(m[4]))/100.0
			}
			d.line = d.line[:0]
		} else {
			d.line = append(d.line, b)
		}
	}
	d.buf.Write(p)
	return len(p), nil
}

// Total returns the scraped input duration in seconds, or 0 when the
// Duration header has not been seen yet.
func (d *durationCapture) Total() float64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.total
}

// String returns the accumulated stderr, matching the plain-buffer
// behavior of the non-progress path for error tail extraction.
func (d *durationCapture) String() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.buf.String()
}

// runWithProgress runs ffmpeg while a reader goroutine translates its
// stdout `-progress` stream into 0-100 percentage callbacks.
func runWithProgress(cmd *exec.Cmd, dur *durationCapture, onProgress func(percent float64)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	parseDone := make(chan struct{})
	go func() {
		defer close(parseDone)
		parseFFmpegProgress(stdout, dur, onProgress)
	}()

	waitErr := cmd.Wait()
	<-parseDone // scanner always terminates; parse errors are non-fatal
	return waitErr
}

// parseFFmpegProgress scans ffmpeg's `-progress pipe:1` key=value output
// and invokes onProgress with the percentage derived from out_time and
// the duration captured from stderr. Updates are throttled to 0.1% steps;
// 100 is only reported on the terminal `progress=end` line so the value
// stays below the frontend's probing-stage threshold while ffmpeg runs.
func parseFFmpegProgress(r io.Reader, dur *durationCapture, onProgress func(percent float64)) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
	var lastSent float64 = -1
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "progress=end" {
			onProgress(100)
			return
		}
		m := outTimeRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		total := dur.Total()
		if total <= 0 {
			continue
		}
		pos := float64(parseIntSafe(m[1]))*3600 +
			float64(parseIntSafe(m[2]))*60 +
			float64(parseIntSafe(m[3])) +
			parseFloatSafe("0."+m[4])
		pct := pos / total * 100
		if pct > 99.9 {
			pct = 99.9
		}
		if pct < 0 {
			pct = 0
		}
		if pct-lastSent >= 0.1 {
			onProgress(pct)
			lastSent = pct
		}
	}
}

func parseFloatSafe(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
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
// manifest is the ordered segment file list (see TranscodeTS).
func TranscodeTSWithFallback(ctx context.Context, inputDir, outputPath string, manifest []string, opts TranscodeOptions) error {
	if !opts.UseGPU {
		return TranscodeTS(ctx, inputDir, outputPath, manifest, opts)
	}

	gpuErr := TranscodeTS(ctx, inputDir, outputPath, manifest, opts)
	if gpuErr == nil {
		return nil
	}

	// Preserve OnProgress across the CPU fallback (see transcodeCopyDirect).
	fallbackOpts := TranscodeOptions{UseGPU: false, OnProgress: opts.OnProgress}
	fallbackErr := transcodeCopyDirect(ctx, inputDir, outputPath, manifest, fallbackOpts)
	if fallbackErr == nil {
		return nil
	}

	return fmt.Errorf("GPU transcoding failed (%v) and CPU fallback also failed (%v)", gpuErr, fallbackErr)
}

// transcodeCopyDirect performs a direct stream copy without GPU options.
// OnProgress (if any) is preserved so the CPU fallback keeps reporting
// progress instead of silently going indeterminate mid-task.
func transcodeCopyDirect(ctx context.Context, inputDir, outputPath string, manifest []string, opts TranscodeOptions) error {
	// Reuse TranscodeTS with UseGPU=false
	opts.UseGPU = false
	return TranscodeTS(ctx, inputDir, outputPath, manifest, opts)
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
