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
	"time"
)

var ffmpegPath = "ffmpeg"

var (
	cpuTranscodeSlots = make(chan struct{}, 2)
	gpuTranscodeSlots = make(chan struct{}, 1)
)

type TranscodeOptions struct {
	UseGPU           bool
	ForceGPUType     string
	ExpectedDuration time.Duration
	// OnProgress receives the transcoding progress as a 0-100 percentage,
	// parsed from ffmpeg's `-progress pipe:1` machine-readable output.
	// It is invoked from a background reader goroutine, so the callback
	// must be cheap and tolerate concurrent calls. Nil disables progress reporting
	// entirely (no -progress args are added, stdout behavior unchanged).
	OnProgress func(percent float64)
}

// TranscodeTS concatenates TS segments and transcodes them into outputPath.
// When manifest is non-empty it is the ordered list of segment file names to
// feed ffmpeg — this is the authoritative input set, so stray .ts files in
// inputDir (stale merge outputs, foreign-variant residue) are ignored. A nil
// manifest falls back to a directory scan (legacy callers only).
func TranscodeTS(ctx context.Context, inputDir, outputPath string, manifest []string, opts ...TranscodeOptions) error {
	if ctx == nil {
		ctx = context.Background()
	}
	dirPath := filepath.Clean(inputDir)
	absDir, err := filepath.Abs(dirPath)
	if err != nil {
		absDir = dirPath
	}

	var files []string
	if len(manifest) > 0 {
		for _, name := range manifest {
			info, statErr := os.Stat(filepath.Join(absDir, name))
			if statErr != nil || info.Size() == 0 {
				continue
			}
			files = append(files, name)
		}
	} else {
		entries, readErr := os.ReadDir(absDir)
		if readErr != nil {
			return fmt.Errorf("cannot read segment directory: %w", readErr)
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
	defer os.Remove(concatPath)
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

	concatResolved, err := filepath.Abs(concatPath)
	if err != nil {
		concatResolved = concatPath
	}
	return transcodeInput(ctx, concatResolved, outputPath, true, firstTranscodeOptions(opts))
}

func TranscodeMergedTS(ctx context.Context, inputPath, outputPath string, opts ...TranscodeOptions) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if inputPath == "" {
		return fmt.Errorf("merged TS input path is empty")
	}
	info, err := os.Stat(inputPath)
	if err != nil {
		return fmt.Errorf("cannot stat merged TS input: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("merged TS input is empty")
	}
	inputResolved, err := filepath.Abs(inputPath)
	if err != nil {
		inputResolved = inputPath
	}
	return transcodeInput(ctx, inputResolved, outputPath, false, firstTranscodeOptions(opts))
}

func firstTranscodeOptions(opts []TranscodeOptions) TranscodeOptions {
	if len(opts) == 0 {
		return TranscodeOptions{}
	}
	return opts[0]
}

func acquireTranscodeSlot(ctx context.Context, useGPU bool) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	slots := cpuTranscodeSlots
	if useGPU {
		slots = gpuTranscodeSlots
	}
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func transcodeInput(ctx context.Context, inputPath, outputPath string, concatInput bool, opt TranscodeOptions) error {
	release, err := acquireTranscodeSlot(ctx, opt.UseGPU)
	if err != nil {
		return err
	}
	defer release()

	outputResolved, err := filepath.Abs(outputPath)
	if err != nil {
		outputResolved = outputPath
	}
	outputDir := filepath.Dir(outputResolved)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}
	ext := filepath.Ext(outputResolved)
	if ext == "" {
		ext = ".mp4"
	}
	tempFile, err := os.CreateTemp(outputDir, "."+filepath.Base(outputResolved)+"-*"+ext)
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	if err := tempFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Remove(tempPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	defer os.Remove(tempPath)
	tempResolved, err := filepath.Abs(tempPath)
	if err != nil {
		tempResolved = tempPath
	}

	var args []string
	if opt.UseGPU {
		args = buildHWAccelArgsForInput(inputPath, tempResolved, opt.ForceGPUType, concatInput)
	} else {
		args = buildCopyArgs(inputPath, tempResolved, concatInput)
	}
	if opt.OnProgress != nil {
		args = append([]string{"-progress", "pipe:1", "-nostats"}, args...)
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	hideConsoleWindow(cmd)
	var runErr error
	var stderrTail func() string
	if opt.OnProgress != nil {
		capture := &durationCapture{expected: opt.ExpectedDuration.Seconds()}
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
		tail := stderrTail()
		if len(tail) > 500 {
			tail = tail[len(tail)-500:]
		}
		return fmt.Errorf("ffmpeg exited with error: %w: %s", runErr, tail)
	}
	info, err := os.Stat(tempPath)
	if err != nil {
		return fmt.Errorf("ffmpeg output is missing: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("ffmpeg output is empty")
	}
	if err := os.Rename(tempPath, outputResolved); err != nil {
		removeErr := os.Remove(outputResolved)
		if removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("cannot replace output: %w", err)
		}
		if err := os.Rename(tempPath, outputResolved); err != nil {
			return fmt.Errorf("cannot publish output: %w", err)
		}
	}
	return nil
}

func buildCopyArgs(inputPath, outputPath string, concatInput bool) []string {
	args := make([]string, 0, 14)
	if concatInput {
		args = append(args, "-f", "concat", "-safe", "0")
	}
	args = append(args, "-i", inputPath, "-c", "copy", "-bsf:a", "aac_adtstoasc")
	args = append(args, faststartArgs...)
	args = append(args, "-y", outputPath)
	return args
}

var faststartArgs = []string{"-movflags", "+faststart"}

// outTimeRe matches the `out_time=H:MM:SS.micros` key of ffmpeg's
// `-progress pipe:1` machine-readable output.
var outTimeRe = regexp.MustCompile(`^out_time=(\d+):(\d{2}):(\d{2})\.(\d+)`)

// durationCapture wraps the ffmpeg stderr buffer and scrapes the input
// header's "Duration: HH:MM:SS.ms" line (printed before any transcoding
// output starts) to establish the 100% reference for progress math.
// Writes arrive on exec's internal copy goroutine while Total is read
// from the stdout parser goroutine, so access is mutex-guarded.
type durationCapture struct {
	mu       sync.Mutex
	buf      bytes.Buffer
	line     []byte
	total    float64
	expected float64
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
	if d.total > 0 {
		return d.total
	}
	return d.expected
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
// the duration captured from stderr. Updates are throttled by time and
// percentage; 100 is only reported on the terminal `progress=end` line.
func parseFFmpegProgress(r io.Reader, dur *durationCapture, onProgress func(percent float64)) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)
	var lastSent float64 = -1
	var lastSentAt time.Time
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
		if pct-lastSent >= 0.5 || lastSentAt.IsZero() || time.Since(lastSentAt) >= 250*time.Millisecond {
			onProgress(pct)
			lastSent = pct
			lastSentAt = time.Now()
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
	metadata, err := ProbeVideoMetadata(ctx, filePath)
	if err != nil {
		return "", nil
	}
	return metadata.Resolution, nil
}

type VideoMetadata struct {
	Duration   float64
	Resolution string
}

func ProbeVideoMetadata(ctx context.Context, filePath string) (VideoMetadata, error) {
	output, err := runFFmpegProbe(ctx, filePath)
	if err != nil {
		return VideoMetadata{}, err
	}
	metadata := VideoMetadata{}
	if match := durationRe.FindStringSubmatch(output); match != nil {
		metadata.Duration = float64(parseIntSafe(match[1])*3600+parseIntSafe(match[2])*60+parseIntSafe(match[3])) + float64(parseIntSafe(match[4]))/100.0
	}
	if match := resolutionRe.FindStringSubmatch(output); match != nil {
		metadata.Resolution = match[1]
	}
	return metadata, nil
}

func runFFmpegProbe(ctx context.Context, filePath string) (string, error) {
	cmd := exec.CommandContext(ctx, ffmpegPath, "-i", filePath)
	hideConsoleWindow(cmd)
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
	return buildCopyArgs(concatPath, outputPath, true)
}

func buildHWAccelArgsForInput(inputPath, outputPath, forceGPUType string, concatInput bool) []string {
	if concatInput {
		return buildHWAccelArgs(inputPath, outputPath, forceGPUType)
	}
	gpuInfo := DetectGPU()
	if forceGPUType != "" {
		forcedType := GPUType(forceGPUType)
		if gpuInfo.Type == forcedType && gpuInfo.Available {
			return buildHWArgsForTypeForInput(gpuInfo, inputPath, outputPath, false)
		}
		return buildForcedHWArgsForInput(forcedType, inputPath, outputPath, false)
	}
	if gpuInfo.SupportsHWTranscode() {
		return buildHWArgsForTypeForInput(gpuInfo, inputPath, outputPath, false)
	}
	return buildCopyArgs(inputPath, outputPath, false)
}

// TranscodeTSWithFallback attempts GPU transcoding first, then falls back to
// CPU stream copy on failure. Returns an error only if both methods fail.
// manifest is the ordered segment file list (see TranscodeTS).
func TranscodeTSWithFallback(ctx context.Context, inputDir, outputPath string, manifest []string, opts TranscodeOptions) error {
	return transcodeWithFallback(ctx, opts, func(options TranscodeOptions) error {
		if !options.UseGPU {
			return transcodeCopyDirect(ctx, inputDir, outputPath, manifest, options)
		}
		return TranscodeTS(ctx, inputDir, outputPath, manifest, options)
	})
}

func TranscodeMergedTSWithFallback(ctx context.Context, inputPath, outputPath string, opts TranscodeOptions) error {
	return transcodeWithFallback(ctx, opts, func(options TranscodeOptions) error {
		return TranscodeMergedTS(ctx, inputPath, outputPath, options)
	})
}

func transcodeWithFallback(ctx context.Context, opts TranscodeOptions, run func(TranscodeOptions) error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if !opts.UseGPU {
		return run(opts)
	}
	gpuErr := run(opts)
	if gpuErr == nil {
		return nil
	}
	if ctx.Err() != nil {
		return gpuErr
	}
	fallbackOpts := opts
	fallbackOpts.UseGPU = false
	fallbackErr := run(fallbackOpts)
	if fallbackErr == nil {
		return nil
	}
	return fmt.Errorf("GPU transcoding failed (%v) and CPU fallback also failed (%v)", gpuErr, fallbackErr)
}

// transcodeCopyDirect performs a direct stream copy without GPU options.
// OnProgress (if any) is preserved so the CPU fallback keeps reporting
// progress instead of going indeterminate mid-task.
func transcodeCopyDirect(ctx context.Context, inputDir, outputPath string, manifest []string, opts TranscodeOptions) error {
	opts.UseGPU = false
	return TranscodeTS(ctx, inputDir, outputPath, manifest, opts)
}

// buildHWArgsForType builds ffmpeg args for a detected GPU type. Input-side
// options (e.g. -hwaccel) must precede -i; output-side options (e.g. -c:v)
// must follow -i but precede the output path. Swapping the order causes
// ffmpeg to reject the command with an input/output option mismatch error.
func buildHWArgsForType(gpu *GPUInfo, concatPath, outputPath string) []string {
	return buildHWArgsForTypeForInput(gpu, concatPath, outputPath, true)
}

func buildHWArgsForTypeForInput(gpu *GPUInfo, inputPath, outputPath string, concatInput bool) []string {
	inputArgs := gpu.GetHWInputArgs()
	outputArgs := gpu.GetHWOutputArgs()
	args := make([]string, 0, len(inputArgs)+len(outputArgs)+8)
	args = append(args, inputArgs...)
	if concatInput {
		args = append(args, "-f", "concat", "-safe", "0")
	}
	args = append(args, "-i", inputPath)
	args = append(args, outputArgs...)
	args = append(args, faststartArgs...)
	args = append(args, "-y", outputPath)
	return args
}

func buildForcedHWArgs(forceType GPUType, concatPath, outputPath string) []string {
	return buildForcedHWArgsForInput(forceType, concatPath, outputPath, true)
}

func buildForcedHWArgsForInput(forceType GPUType, inputPath, outputPath string, concatInput bool) []string {
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
		return buildCopyArgs(inputPath, outputPath, concatInput)
	}
	return buildHWArgsForTypeForInput(tempInfo, inputPath, outputPath, concatInput)
}
