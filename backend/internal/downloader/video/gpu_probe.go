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
	GPUTypeNone         GPUType = ""             // No GPU acceleration
	GPUTypeNVENC        GPUType = "nvenc"        // NVIDIA NVENC (Windows/Linux)
	GPUTypeQSV          GPUType = "qsv"          // Intel Quick Sync Video (Windows/Linux)
	GPUTypeVAAPI        GPUType = "vaapi"        // VAAPI (Linux only)
	GPUTypeAMF          GPUType = "amf"          // AMD AMF (Windows)
	GPUTypeVideotoolbox GPUType = "videotoolbox" // macOS VideoToolbox
)

// GPUKind classifies the detected GPU as discrete (dedicated) or
// integrated (part of the CPU/chipset). Used to decide whether GPU
// transcoding should be enabled by default: discrete GPUs are preferred
// for hardware accelerate, while integrated GPUs are conservatively
// disabled (users can enable them explicitly).
type GPUKind string

const (
	GPUKindDiscrete   GPUKind = "discrete"
	GPUKindIntegrated GPUKind = "integrated"
	GPUKindUnknown    GPUKind = "unknown"
)

// GPUInfo holds detected GPU capabilities and the best available encoder.
type GPUInfo struct {
	Type           GPUType `json:"type"`
	EncoderName    string  `json:"encoder_name"`          // e.g. "h264_nvenc", "h264_qsv"
	DecoderName    string  `json:"decoder_name"`          // e.g. "h264_cuvid" for hardware decode
	GPUName        string  `json:"gpu_name"`              // e.g. "NVIDIA GeForce RTX 4090"
	DriverVersion  string  `json:"driver_version"`        // e.g. "535.129.03"
	Available      bool    `json:"available"`             // true if any HW encoder was found
	CUDASupport    bool    `json:"cuda_support"`          // true if CUDA is available (NVENC)
	Kind           GPUKind `json:"kind"`                  // discrete / integrated / unknown
	DetectionError string  `json:"detection_error,omitempty"` // non-empty if detection failed
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

// DetectGPU probes the system for available hardware-accelerated encoders
// by invoking ffmpeg -encoders and parsing the output. Results are cached
// after the first call; subsequent calls return the cached result.
//
// GPU hardware identification uses:
//   - github.com/jaypipes/ghw — cross-platform PCI hardware discovery
//     (replaces PowerShell WMI on Windows, lspci/vainfo on Linux, and
//     sysctl on macOS). ghw reads PCI device info in-process via sysfs
//     (Linux), WMI via go-ole (Windows), or IOKit (macOS).
//   - nvidia-smi — a SINGLE subprocess call to query NVIDIA driver version
//     and CUDA availability. This replaces the original 3 separate calls
//     (name, driver, CUDA). GPU name is now resolved via ghw.
func DetectGPU() *GPUInfo {
	gpuInfoOnce.Do(func() {
		cachedGPUInfo = probeGPU()
	})
	return cachedGPUInfo
}

// ResetGPUCache clears the cached GPU info, forcing re-detection on next
// DetectGPU call. Useful after FFmpeg path changes or GPU configuration updates.
// Thread-safe: uses a new sync.Once for the next detection cycle.
func ResetGPUCache() {
	gpuInfoOnce = sync.Once{}
	cachedGPUInfo = nil
}

// SetFFmpegPathForGPU updates the ffmpeg binary path used for GPU detection.
// Must be called before DetectGPU() if a custom FFmpeg path is needed.
// Thread-safe: protected by mutex.
func SetFFmpegPathForGPU(path string) {
	ffmpegProbeMux.Lock()
	defer ffmpegProbeMux.Unlock()
	if path != "" {
		ffmpegPathForProbe = path
	}
}

// GetFFmpegPathForGPU returns the current ffmpeg path used for GPU detection.
func GetFFmpegPathForGPU() string {
	ffmpegProbeMux.Lock()
	defer ffmpegProbeMux.Unlock()
	return ffmpegPathForProbe
}

// ffmpegPathForProbe is the ffmpeg binary used for GPU detection.
// Protected by ffmpegProbeMux for thread-safe updates.
var ffmpegPathForProbe = "ffmpeg"

// probeGPU performs the actual GPU hardware detection.
//
// Pipeline:
//  1. Query ffmpeg -encoders to determine which HW encoders are compiled in.
//     This is the only external process spawned; it gates whether GPU detection
//     proceeds at all.
//  2. For NVIDIA: use go-nvml (CGO bindings to libnvidia-ml) to query
//     GPU name, driver version, and CUDA compute capability in-process.
//     Falls back to nvidia-smi if NVML init fails (e.g. no libnvidia-ml).
//  3. For Intel/AMD: use ghw to enumerate PCI display controllers and
//     extract vendor/product names from the PCI database. This replaces
//     PowerShell WMI calls on Windows and lspci on Linux.
//  4. For macOS: use ghw to read the GPU model from the system's IOKit
//     registry, replacing the sysctl subprocess call.
func probeGPU() *GPUInfo {
	info := &GPUInfo{
		Type:      GPUTypeNone,
		Available: false,
	}

	// Step 1: Query ffmpeg encoders to know which HW encoders are available.
	encoders, err := getFFmpegEncoders()
	if err != nil || len(encoders) == 0 {
		info.DetectionError = fmt.Sprintf("failed to query ffmpeg encoders: %v", err)
		return info
	}

	// Step 2: Detect platform-specific GPUs in parallel.
	var (
		wg                                                        sync.WaitGroup
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

	// Pick the best result by priority: NVENC > QSV > VAAPI > AMF > VideoToolbox
	candidates := []GPUInfo{nvidiaInfo, intelInfo, vaapiInfo, amdInfo, vtInfo}
	for _, c := range candidates {
		if c.Available {
			*info = c
			return info
		}
	}

	return info
}

// --- NVIDIA detection (ghw for name + single nvidia-smi for driver/CUDA) ---

// detectNVIDIAGPU detects NVIDIA NVENC GPU info. GPU name is queried via ghw
// (in-process PCI database lookup), while driver version and CUDA support
// are queried via a SINGLE nvidia-smi subprocess call.
//
// This replaces the original approach that spawned nvidia-smi 3 times
// (name, driver, CUDA separately). Now ghw handles the name, and a
// single nvidia-smi call handles driver + CUDA in one shot.
func detectNVIDIAGPU(info *GPUInfo) {
	info.Type = GPUTypeNVENC
	info.EncoderName = "h264_nvenc"
	info.DecoderName = "h264_cuvid"
	info.Available = true
	// NVIDIA GPUs are always dedicated/discrete accelerators.
	info.Kind = GPUKindDiscrete

	// GPU name via ghw (in-process PCI lookup, no subprocess).
	name, found := findGPUByVendor("NVIDIA")
	if found {
		info.GPUName = name
	} else {
		info.GPUName = "NVIDIA GPU (NVENC)"
	}

	// Driver version and CUDA support via a SINGLE nvidia-smi call.
	driver, cudaOK := queryNVIDIADriverAndCUDA()
	info.DriverVersion = driver
	info.CUDASupport = cudaOK
}

// nvidiaSMICache caches the result of the single nvidia-smi subprocess call
// so driver version and CUDA support are only queried once per process.
var nvidiaSMICache struct {
	once    sync.Once
	driver  string
	cudaOK  bool
}

// queryNVIDIADriverAndCUDA queries NVIDIA driver version and CUDA availability
// in a SINGLE nvidia-smi invocation. Uses sync.Once for caching so multiple
// goroutines calling this function share the same subprocess result.
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
		// If nvidia-smi succeeded and returned a driver version, CUDA is available.
		nvidiaSMICache.cudaOK = nvidiaSMICache.driver != ""
	})
	return nvidiaSMICache.driver, nvidiaSMICache.cudaOK
}

// --- Intel/AMD detection via ghw (replaces PowerShell/lspci) ---

// gpuListCache caches the ghw GPU info result so we only enumerate PCI
// devices once per process lifetime. ghw's New() can be expensive on
// some systems (especially Windows WMI), so caching is essential.
var gpuListCache struct {
	once  sync.Once
	cards []*gpu.GraphicsCard
	err   error
}

// getGraphicsCards enumerates all graphics cards via ghw and caches the result.
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

// findGPUByVendor searches the cached GPU list for a card matching the
// given vendor name substring (e.g. "NVIDIA", "Intel", "AMD", "Radeon").
// Returns the product name and true if found.
func findGPUByVendor(vendorMatch string) (string, bool) {
	cards, err := getGraphicsCards()
	if err != nil || len(cards) == 0 {
		return "", false
	}
	for _, card := range cards {
		if card.DeviceInfo == nil {
			continue
		}
		// Check vendor name
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
		// Also check product name for vendor keywords (e.g. "Radeon" for AMD)
		if card.DeviceInfo.Product != nil {
			productName := card.DeviceInfo.Product.Name
			if strings.Contains(strings.ToLower(productName), strings.ToLower(vendorMatch)) {
				return productName, true
			}
		}
	}
	return "", false
}

// detectIntelGPUWindows detects Intel QSV GPU on Windows using ghw.
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

// detectAMDGPUWindows detects AMD AMF GPU on Windows using ghw.
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

// detectIntelGPULinux detects Intel QSV GPU on Linux using ghw.
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

// detectVAAPIGPU detects VAAPI (Intel/AMD) on Linux using ghw.
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

// detectMacOSGPUVT detects VideoToolbox on macOS using ghw.
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

// --- ffmpeg encoder list query ---

// getFFmpegEncoders invokes ffmpeg -encoders and returns the parsed output.
// Thread-safe: uses mutex to prevent concurrent ffmpeg probe invocations.
func getFFmpegEncoders() ([]string, error) {
	ffmpegProbeMux.Lock()
	path := ffmpegPathForProbe
	ffmpegProbeMux.Unlock()

	// Use a short timeout to prevent hanging.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, "-encoders")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg -encoders failed: %w", err)
	}
	return strings.Split(string(output), "\n"), nil
}

// hasExactEncoder performs precise encoder name matching.
// Unlike strings.Contains, this checks for the exact encoder name
// as a standalone token to avoid false positives (e.g., "h264_nvenc"
// should not match "some_h264_nvenc_wrapper").
func hasExactEncoder(encoders []string, name string) bool {
	for _, line := range encoders {
		// ffmpeg encoder list format: " V..... h264_nvenc           NVIDIA NVENC H.264 encoder"
		// We need to match the encoder name as a whole word
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

// --- Helpers ---

// truncateLine trims a string to maxLen, appending "..." if truncated.
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
// returned a flat slice that mixed input options (e.g. -hwaccel) and output
// options (e.g. -c:v), which caused ffmpeg to reject the command when all
// args were placed between -i and the output file. The split methods allow
// the caller to position each group on the correct side of -i / output.
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

// getVAAPIDevice returns the first available VAAPI render device node.
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

// GetDecoderArgs returns hardware-accelerated decoder arguments if available.
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

// SupportsHWTranscode returns true if the GPU can be used for hardware-accelerated
// transcoding (not just stream copy).
func (gi *GPUInfo) SupportsHWTranscode() bool {
	return gi.Available && gi.Type != GPUTypeNone
}

// String returns a human-readable description of the GPU.
func (gi *GPUInfo) String() string {
	if !gi.Available {
		if gi.DetectionError != "" {
			return "GPU detection failed: " + gi.DetectionError
		}
		return "No GPU acceleration available"
	}
	return fmt.Sprintf("%s [%s]", gi.GPUName, strings.ToUpper(string(gi.Type)))
}
