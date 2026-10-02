package video

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/jaypipes/ghw/pkg/gpu"
)

// GPUType represents the type of hardware-accelerated encoder available.
type GPUType string

const (
	GPUTypeNone         GPUType = ""
	GPUTypeNVENC        GPUType = "nvenc"
	GPUTypeQSV          GPUType = "qsv"
	GPUTypeVAAPI        GPUType = "vaapi"
	GPUTypeAMF          GPUType = "amf"
	GPUTypeVideotoolbox GPUType = "videotoolbox"
)

// GPUKind classifies the detected GPU as discrete (dedicated) or integrated
// (part of the CPU or chipset). Discrete GPUs are preferred for hardware
// transcoding, while integrated GPUs stay disabled unless enabled explicitly.
type GPUKind string

const (
	GPUKindDiscrete   GPUKind = "discrete"
	GPUKindIntegrated GPUKind = "integrated"
	GPUKindUnknown    GPUKind = "unknown"
)

// GPUInfo holds detected GPU capabilities and the best available encoder.
type GPUInfo struct {
	Type           GPUType `json:"type"`
	EncoderName    string  `json:"encoder_name"` // e.g. "h264_nvenc", "h264_qsv"
	DecoderName    string  `json:"decoder_name"` // e.g. "h264_cuvid"
	GPUName        string  `json:"gpu_name"`     // e.g. "NVIDIA GeForce RTX 4090"
	DriverVersion  string  `json:"driver_version"`
	Available      bool    `json:"available"`
	CUDASupport    bool    `json:"cuda_support"`
	Kind           GPUKind `json:"kind"`
	DetectionError string  `json:"detection_error,omitempty"`
}

// IsDiscrete reports whether the GPU was classified as a discrete
// (dedicated) GPU. Unknown/integrated GPUs return false so callers
// treat them conservatively (i.e. do not auto-enable GPU transcoding).
func (gi *GPUInfo) IsDiscrete() bool {
	return gi != nil && gi.Kind == GPUKindDiscrete
}

var (
	gpuInfoOnce    sync.Once
	cachedGPUInfo  *GPUInfo
	ffmpegProbeMux sync.Mutex // serializes ffmpeg probe commands to avoid race
)

// DetectGPU probes the system for hardware-accelerated encoders by invoking
// ffmpeg -encoders and parsing the output. The result is cached after the
// first call.
//
// Hardware identification relies on two external sources:
//   - github.com/jaypipes/ghw for cross-platform PCI discovery, reading
//     sysfs on Linux, WMI on Windows, and IOKit on macOS in-process.
//   - A single nvidia-smi call for the NVIDIA driver version and CUDA
//     availability, replacing separate per-attribute queries.
func DetectGPU() *GPUInfo {
	gpuInfoOnce.Do(func() {
		cachedGPUInfo = probeGPU()
	})
	return cachedGPUInfo
}

// ResetGPUCache clears the cached GPU info, forcing re-detection on the next
// DetectGPU call, for example after an FFmpeg path or GPU configuration change.
func ResetGPUCache() {
	gpuInfoOnce = sync.Once{}
	cachedGPUInfo = nil
}

// SetFFmpegPathForGPU updates the ffmpeg binary path used for GPU detection.
// Must be called before DetectGPU() if a custom FFmpeg path is needed.
// Protected by ffmpegProbeMux.
func SetFFmpegPathForGPU(path string) {
	ffmpegProbeMux.Lock()
	defer ffmpegProbeMux.Unlock()
	if path != "" {
		ffmpegPathForProbe = path
	}
}

func GetFFmpegPathForGPU() string {
	ffmpegProbeMux.Lock()
	defer ffmpegProbeMux.Unlock()
	return ffmpegPathForProbe
}

// ffmpeg binary used for GPU detection, guarded by ffmpegProbeMux.
var ffmpegPathForProbe = "ffmpeg"

// ffmpeg -encoders is the only external process involved, so PCI
// enumeration is skipped when it reports no hardware encoder.
func probeGPU() *GPUInfo {
	info := &GPUInfo{
		Type:      GPUTypeNone,
		Available: false,
	}

	encoders, err := getFFmpegEncoders()
	if err != nil || len(encoders) == 0 {
		info.DetectionError = fmt.Sprintf("failed to query ffmpeg encoders: %v", err)
		return info
	}

	var (
		wg                                                sync.WaitGroup
		nvidiaInfo, intelInfo, amdInfo, vaapiInfo, vtInfo GPUInfo
	)

	switch runtime.GOOS {
	case "windows":
		if hasExactEncoder(encoders, "h264_nvenc") || hasExactEncoder(encoders, "hevc_nvenc") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectNVIDIAGPU(&nvidiaInfo)
			}()
		}
		if hasExactEncoder(encoders, "h264_qsv") || hasExactEncoder(encoders, "hevc_qsv") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectIntelGPUWindows(&intelInfo)
			}()
		}
		if hasExactEncoder(encoders, "h264_amf") || hasExactEncoder(encoders, "hevc_amf") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectAMDGPUWindows(&amdInfo)
			}()
		}
	case "linux":
		if hasExactEncoder(encoders, "h264_nvenc") || hasExactEncoder(encoders, "hevc_nvenc") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectNVIDIAGPU(&nvidiaInfo)
			}()
		}
		if hasExactEncoder(encoders, "h264_qsv") || hasExactEncoder(encoders, "hevc_qsv") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectIntelGPULinux(&intelInfo)
			}()
		}
		if hasExactEncoder(encoders, "h264_vaapi") || hasExactEncoder(encoders, "hevc_vaapi") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectVAAPIGPU(&vaapiInfo)
			}()
		}
	case "darwin":
		if hasExactEncoder(encoders, "h264_videotoolbox") || hasExactEncoder(encoders, "hevc_videotoolbox") {
			wg.Add(1)
			go func() {
				defer wg.Done()
				detectMacOSGPUVT(&vtInfo)
			}()
		}
	}

	wg.Wait()

	// Priority: NVENC > QSV > VAAPI > AMF > VideoToolbox.
	candidates := []GPUInfo{nvidiaInfo, intelInfo, vaapiInfo, amdInfo, vtInfo}
	for _, c := range candidates {
		if c.Available {
			*info = c
			return info
		}
	}

	return info
}

func detectNVIDIAGPU(info *GPUInfo) {
	info.Type = GPUTypeNVENC
	info.EncoderName = "h264_nvenc"
	info.DecoderName = "h264_cuvid"
	info.Available = true
	// NVIDIA GPUs are always dedicated/discrete accelerators.
	info.Kind = GPUKindDiscrete

	name, found := findGPUByVendor("NVIDIA")
	if found {
		info.GPUName = name
	} else {
		info.GPUName = "NVIDIA GPU (NVENC)"
	}

	driver, cudaOK := queryNVIDIADriverAndCUDA()
	info.DriverVersion = driver
	info.CUDASupport = cudaOK
}

var nvidiaSMICache struct {
	once   sync.Once
	driver string
	cudaOK bool
}

func queryNVIDIADriverAndCUDA() (string, bool) {
	nvidiaSMICache.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "nvidia-smi",
			"--query-gpu=driver_version",
			"--format=csv,noheader,nounits")
		output, err := cmd.Output()
		if err != nil {
			nvidiaSMICache.driver = ""
			nvidiaSMICache.cudaOK = false
			return
		}

		line := strings.TrimSpace(string(output))
		if idx := strings.Index(line, "\n"); idx >= 0 {
			line = line[:idx]
		}
		nvidiaSMICache.driver = strings.TrimSpace(line)
		// A non-empty driver version implies CUDA is available.
		nvidiaSMICache.cudaOK = nvidiaSMICache.driver != ""
	})
	return nvidiaSMICache.driver, nvidiaSMICache.cudaOK
}

// gpuListCache enumerates PCI devices once per process because ghw.New
// can be slow, notably through WMI on Windows.
var gpuListCache struct {
	once  sync.Once
	cards []*gpu.GraphicsCard
	err   error
}

func getGraphicsCards() ([]*gpu.GraphicsCard, error) {
	gpuListCache.once.Do(func() {
		info, err := gpu.New()
		if err != nil {
			gpuListCache.err = err
			return
		}
		gpuListCache.cards = info.GraphicsCards
	})
	return gpuListCache.cards, gpuListCache.err
}

func findGPUByVendor(vendorMatch string) (string, bool) {
	cards, err := getGraphicsCards()
	if err != nil || len(cards) == 0 {
		return "", false
	}
	for _, card := range cards {
		if card.DeviceInfo == nil {
			continue
		}
		if card.DeviceInfo.Vendor != nil {
			vendorName := card.DeviceInfo.Vendor.Name
			if strings.Contains(strings.ToLower(vendorName), strings.ToLower(vendorMatch)) {
				productName := "Unknown"
				if card.DeviceInfo.Product != nil {
					productName = card.DeviceInfo.Product.Name
				}
				if productName == "" {
					productName = vendorMatch + " GPU"
				}
				return productName, true
			}
		}
		if card.DeviceInfo.Product != nil {
			productName := card.DeviceInfo.Product.Name
			if strings.Contains(strings.ToLower(productName), strings.ToLower(vendorMatch)) {
				return productName, true
			}
		}
	}
	return "", false
}

func detectIntelGPUWindows(info *GPUInfo) {
	info.Type = GPUTypeQSV
	info.EncoderName = "h264_qsv"
	info.Available = true

	name, found := findGPUByVendor("Intel")
	if found {
		info.GPUName = name
		info.Kind = classifyIntelKind(name)
	} else {
		info.GPUName = "Intel GPU (QSV)"
		info.Kind = GPUKindIntegrated
	}
}

// classifyIntelKind distinguishes discrete Intel Arc GPUs from the
// integrated iGPU built into Intel CPUs.
func classifyIntelKind(name string) GPUKind {
	if strings.Contains(strings.ToLower(name), "arc") {
		return GPUKindDiscrete
	}
	return GPUKindIntegrated
}

// classifyAMDKind distinguishes discrete Radeon GPUs from the integrated
// Radeon graphics embedded in AMD APUs.
func classifyAMDKind(name string) GPUKind {
	n := strings.ToLower(name)
	if strings.Contains(n, "radeon") && !strings.Contains(n, "graphics") {
		return GPUKindDiscrete
	}
	return GPUKindIntegrated
}

func detectAMDGPUWindows(info *GPUInfo) {
	info.Type = GPUTypeAMF
	info.EncoderName = "h264_amf"
	info.Available = true

	// Try "AMD" first, then "Radeon" (AMD's consumer GPU brand).
	name, found := findGPUByVendor("AMD")
	if !found {
		name, found = findGPUByVendor("Radeon")
	}
	if found {
		info.GPUName = name
		info.Kind = classifyAMDKind(name)
	} else {
		info.GPUName = "AMD GPU (AMF)"
		info.Kind = GPUKindUnknown
	}
}

func detectIntelGPULinux(info *GPUInfo) {
	info.Type = GPUTypeQSV
	info.EncoderName = "h264_qsv"
	info.Available = true

	name, found := findGPUByVendor("Intel")
	if found {
		info.GPUName = name
		info.Kind = classifyIntelKind(name)
	} else {
		info.GPUName = "Intel GPU (QSV)"
		info.Kind = GPUKindIntegrated
	}
}

func detectVAAPIGPU(info *GPUInfo) {
	info.Type = GPUTypeVAAPI
	info.EncoderName = "h264_vaapi"
	info.Available = true

	// VAAPI can be either Intel or AMD; try both.
	name, found := findGPUByVendor("Intel")
	if !found {
		name, found = findGPUByVendor("AMD")
	}
	if !found {
		name, found = findGPUByVendor("Radeon")
	}
	if found {
		info.GPUName = name
		info.Kind = classifyIntelKind(name)
		if strings.Contains(strings.ToLower(name), "radeon") || strings.Contains(strings.ToLower(name), "amd") {
			info.Kind = classifyAMDKind(name)
		}
	} else {
		info.GPUName = "VAAPI GPU"
		info.Kind = GPUKindIntegrated
	}
}

func detectMacOSGPUVT(info *GPUInfo) {
	info.Type = GPUTypeVideotoolbox
	info.EncoderName = "h264_videotoolbox"
	info.Available = true

	// On macOS, ghw reads from IOKit registry. Try common vendor names.
	name, found := findGPUByVendor("Apple")
	if !found {
		name, found = findGPUByVendor("Intel")
	}
	if !found {
		name, found = findGPUByVendor("AMD")
	}
	if found {
		info.GPUName = name + " (VideoToolbox)"
		// Apple Silicon / Intel iGPU are integrated; discrete AMD/other
		// discrete GPUs are rarer on macOS and conservatively treated as
		// integrated so GPU transcoding is not force-enabled by default.
		info.Kind = GPUKindIntegrated
		if strings.Contains(strings.ToLower(name), "radeon") || strings.Contains(strings.ToLower(name), "amd") {
			info.Kind = GPUKindDiscrete
		}
	} else {
		info.GPUName = "Apple/Intel GPU (VideoToolbox)"
		info.Kind = GPUKindIntegrated
	}
}

func getFFmpegEncoders() ([]string, error) {
	ffmpegProbeMux.Lock()
	path := ffmpegPathForProbe
	ffmpegProbeMux.Unlock()

	// A hung ffmpeg would otherwise stall detection indefinitely.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, "-encoders")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg -encoders failed: %w", err)
	}
	return strings.Split(string(output), "\n"), nil
}

// hasExactEncoder matches the encoder name as a standalone token, so
// "h264_nvenc" does not match a hypothetical "some_h264_nvenc_wrapper".
func hasExactEncoder(encoders []string, name string) bool {
	for _, line := range encoders {
		if strings.Contains(line, " "+name+" ") ||
			strings.Contains(line, "\t"+name+"\t") ||
			strings.Contains(line, " "+name+"\t") ||
			strings.Contains(line, "\t"+name+" ") ||
			strings.HasSuffix(line, " "+name) {
			return true
		}
	}
	return false
}

func truncateLine(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}

// GetHWAccelArgs returns the ffmpeg arguments for hardware-accelerated encoding
// based on the detected GPU type.
//
// Deprecated: Use GetHWInputArgs and GetHWOutputArgs instead. This method
// returns a flat slice that mixes input options (e.g. -hwaccel) and output
// options (e.g. -c:v); ffmpeg rejects the command when all args are placed
// between -i and the output file. The split methods let the caller position
// each group on the correct side of -i / output.
func (gi *GPUInfo) GetHWAccelArgs() []string {
	input := gi.GetHWInputArgs()
	output := gi.GetHWOutputArgs()
	result := make([]string, 0, len(input)+len(output))
	result = append(result, input...)
	result = append(result, output...)
	return result
}

// GetHWInputArgs returns ffmpeg input-side options that must appear BEFORE
// the -i argument (e.g. -hwaccel, -hwaccel_output_format, -vaapi_device).
func (gi *GPUInfo) GetHWInputArgs() []string {
	switch gi.Type {
	case GPUTypeNVENC:
		return []string{
			"-hwaccel", "cuda",
			"-hwaccel_output_format", "cuda",
		}
	case GPUTypeQSV:
		return []string{
			"-hwaccel", "qsv",
		}
	case GPUTypeVAAPI:
		device := getVAAPIDevice()
		return []string{
			"-vaapi_device", device,
		}
	case GPUTypeAMF:
		return []string{
			"-hwaccel", "d3d11va",
		}
	case GPUTypeVideotoolbox:
		return nil
	default:
		return nil
	}
}

// GetHWOutputArgs returns ffmpeg output-side options that must appear AFTER
// the -i argument and BEFORE the output file path (e.g. -c:v, -preset, -vf).
func (gi *GPUInfo) GetHWOutputArgs() []string {
	switch gi.Type {
	case GPUTypeNVENC:
		return []string{
			"-c:v", gi.EncoderName,
			"-preset", "p4",
			"-tune", "ull",
			"-b:v", "0",
			"-rc", "vbr",
			"-cq", "23",
		}
	case GPUTypeQSV:
		return []string{
			"-c:v", gi.EncoderName,
			"-preset", "medium",
			"-global_quality", "23",
		}
	case GPUTypeVAAPI:
		return []string{
			"-vf", "format=nv12,hwupload",
			"-c:v", gi.EncoderName,
		}
	case GPUTypeAMF:
		return []string{
			"-c:v", gi.EncoderName,
			"-quality", "speed",
			"-usage", "ultralowlatency",
		}
	case GPUTypeVideotoolbox:
		return []string{
			"-c:v", gi.EncoderName,
			"-realtime", "true",
			"-profile:v", "high",
		}
	default:
		return nil
	}
}

func getVAAPIDevice() string {
	devices := []string{
		"/dev/dri/renderD128",
		"/dev/dri/renderD129",
		"/dev/dri/card0",
		"/dev/dri/card1",
	}
	for _, dev := range devices {
		if _, err := os.Stat(dev); err == nil {
			return dev
		}
	}
	return "/dev/dri/renderD128"
}

func (gi *GPUInfo) GetDecoderArgs() []string {
	switch gi.Type {
	case GPUTypeNVENC:
		if gi.DecoderName != "" {
			return []string{"-c:v", gi.DecoderName}
		}
	case GPUTypeQSV:
		return []string{"-c:v", "h264_qsv"}
	case GPUTypeAMF:
		return []string{"-hwaccel", "dxva2"}
	}
	return nil
}

func (gi *GPUInfo) SupportsHWTranscode() bool {
	return gi.Available && gi.Type != GPUTypeNone
}

func (gi *GPUInfo) String() string {
	if !gi.Available {
		if gi.DetectionError != "" {
			return "GPU detection failed: " + gi.DetectionError
		}
		return "No GPU acceleration available"
	}
	return fmt.Sprintf("%s [%s]", gi.GPUName, strings.ToUpper(string(gi.Type)))
}
