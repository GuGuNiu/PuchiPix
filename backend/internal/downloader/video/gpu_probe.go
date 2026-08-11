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

	// commandTimeout is the max duration for external GPU query commands
	// to prevent hanging the entire detection process.
	commandTimeout = 5 * time.Second
)

// GPUInfo holds detected GPU capabilities and the best available encoder.
type GPUInfo struct {
	Type           GPUType `json:"type"`
	EncoderName    string  `json:"encoder_name"`    // e.g. "h264_nvenc", "h264_qsv"
	DecoderName    string  `json:"decoder_name"`    // e.g. "h264_cuvid" for hardware decode
	GPUName        string  `json:"gpu_name"`        // e.g. "NVIDIA GeForce RTX 4090"
	DriverVersion  string  `json:"driver_version"`  // e.g. "535.129.03"
	Available      bool    `json:"available"`       // true if any HW encoder was found
	CUDASupport    bool    `json:"cuda_support"`    // true if CUDA is available (NVENC)
	DetectionError string  `json:"detection_error,omitempty"` // non-empty if detection failed
}

var (
	gpuInfoOnce    sync.Once
	cachedGPUInfo  *GPUInfo
	ffmpegProbeMux sync.Mutex // serializes ffmpeg probe commands to avoid race
)

// DetectGPU probes the system for available hardware-accelerated encoders
// by invoking ffmpeg -encoders and parsing the output. Results are cached
// after the first call; subsequent calls return the cached result.
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

// probeGPU performs the actual GPU hardware detection with proper timeout
// and error handling for all external command invocations.
func probeGPU() *GPUInfo {
	info := &GPUInfo{
		Type:      GPUTypeNone,
		Available: false,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get list of hardware accelerators and encoders from ffmpeg
	encoders, err := getFFmpegEncoders(ctx)
	if err != nil || len(encoders) == 0 {
		info.DetectionError = fmt.Sprintf("failed to query ffmpeg encoders: %v", err)
		return info
	}

	// Detect platform-specific GPUs
	switch runtime.GOOS {
	case "windows":
		detectWindowsGPU(info, encoders)
	case "linux":
		detectLinuxGPU(info, encoders)
	case "darwin":
		detectMacOSGPU(info, encoders)
	}

	return info
}

// getFFmpegEncoders invokes ffmpeg -encoders and returns the parsed output.
// Thread-safe: uses mutex to prevent concurrent ffmpeg probe invocations.
func getFFmpegEncoders(ctx context.Context) ([]string, error) {
	ffmpegProbeMux.Lock()
	path := ffmpegPathForProbe
	ffmpegProbeMux.Unlock()

	cmd := exec.CommandContext(ctx, path, "-encoders")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg -encoders failed: %w", err)
	}
	return strings.Split(string(output), "\n"), nil
}

// detectWindowsGPU checks for NVIDIA (NVENC), Intel (QSV), and AMD (AMF) on Windows.
// Each query uses context with timeout to prevent hanging.
func detectWindowsGPU(info *GPUInfo, encoders []string) {
	// Check for NVIDIA NVENC (highest priority - best performance)
	if hasExactEncoder(encoders, "h264_nvenc") || hasExactEncoder(encoders, "hevc_nvenc") {
		info.Type = GPUTypeNVENC
		info.EncoderName = "h264_nvenc"
		info.DecoderName = "h264_cuvid"
		info.Available = true
		info.GPUName = queryNVIDIAName()
		info.DriverVersion = queryNVIDIADriver()
		info.CUDASupport = checkCUDASupport()
		return
	}

	// Check for Intel QSV
	if hasExactEncoder(encoders, "h264_qsv") || hasExactEncoder(encoders, "hevc_qsv") {
		info.Type = GPUTypeQSV
		info.EncoderName = "h264_qsv"
		info.Available = true
		info.GPUName = queryIntelGPUNameWindows()
		return
	}

	// Check for AMD AMF
	if hasExactEncoder(encoders, "h264_amf") || hasExactEncoder(encoders, "hevc_amf") {
		info.Type = GPUTypeAMF
		info.EncoderName = "h264_amf"
		info.Available = true
		info.GPUName = queryAMDGPUNameWindows()
		return
	}
}

// detectLinuxGPU checks for NVIDIA (NVENC), Intel (QSV/VAAPI), AMD (VAAPI) on Linux.
func detectLinuxGPU(info *GPUInfo, encoders []string) {
	// Check for NVIDIA NVENC (highest priority)
	if hasExactEncoder(encoders, "h264_nvenc") || hasExactEncoder(encoders, "hevc_nvenc") {
		info.Type = GPUTypeNVENC
		info.EncoderName = "h264_nvenc"
		info.DecoderName = "h264_cuvid"
		info.Available = true
		info.GPUName = queryNVIDIAName()
		info.DriverVersion = queryNVIDIADriver()
		info.CUDASupport = checkCUDASupport()
		return
	}

	// Check for Intel QSV
	if hasExactEncoder(encoders, "h264_qsv") || hasExactEncoder(encoders, "hevc_qsv") {
		info.Type = GPUTypeQSV
		info.EncoderName = "h264_qsv"
		info.Available = true
		info.GPUName = queryIntelGPULinux()
		return
	}

	// Check for VAAPI (Intel/AMD on Linux)
	if hasExactEncoder(encoders, "h264_vaapi") || hasExactEncoder(encoders, "hevc_vaapi") {
		info.Type = GPUTypeVAAPI
		info.EncoderName = "h264_vaapi"
		info.Available = true
		info.GPUName = queryVAAPIRenderer()
		return
	}
}

// detectMacOSGPU checks for VideoToolbox (Apple Silicon/Intel Mac) on macOS.
func detectMacOSGPU(info *GPUInfo, encoders []string) {
	if hasExactEncoder(encoders, "h264_videotoolbox") || hasExactEncoder(encoders, "hevc_videotoolbox") {
		info.Type = GPUTypeVideotoolbox
		info.EncoderName = "h264_videotoolbox"
		info.Available = true
		info.GPUName = queryMacOSChip()
		return
	}
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

// --- Cross-platform NVIDIA queries (with timeout) ---

func queryNVIDIAName() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name", "--format=csv,noheader")
	output, err := cmd.Output()
	if err != nil {
		return "NVIDIA GPU"
	}
	name := strings.TrimSpace(string(output))
	if idx := strings.Index(name, "\n"); idx >= 0 {
		name = name[:idx]
	}
	return name
}

func queryNVIDIADriver() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	version := strings.TrimSpace(string(output))
	if idx := strings.Index(version, "\n"); idx >= 0 {
		version = version[:idx]
	}
	return version
}

func checkCUDASupport() bool {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nvidia-smi")
	err := cmd.Run()
	return err == nil
}

// --- Windows-specific GPU queries ---

func queryIntelGPUNameWindows() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-Command",
		"Get-WmiObject Win32_VideoController | Where-Object { $_.Name -like '*Intel*' } | Select-Object -ExpandProperty Name -First 1")
	output, err := cmd.Output()
	if err != nil {
		return "Intel GPU (QSV)"
	}
	name := strings.TrimSpace(string(output))
	if name == "" {
		name = "Intel GPU (QSV)"
	}
	return name
}

func queryAMDGPUNameWindows() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-Command",
		"Get-WmiObject Win32_VideoController | Where-Object { $_.Name -like '*AMD*' -or $_.Name -like '*Radeon*' } | Select-Object -ExpandProperty Name -First 1")
	output, err := cmd.Output()
	if err != nil {
		return "AMD GPU (AMF)"
	}
	name := strings.TrimSpace(string(output))
	if name == "" {
		name = "AMD GPU (AMF)"
	}
	return name
}

// --- Linux-specific GPU queries ---

func queryIntelGPULinux() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", "lspci -nn 2>/dev/null | grep -i 'vga\\|3d\\|display'")
	output, err := cmd.Output()
	if err != nil {
		// Fallback: try reading from sysfs
		if data, readErr := os.ReadFile("/sys/class/drm/card0/device/vendor"); readErr == nil && strings.Contains(string(data), "0x8086") {
			return "Intel GPU (QSV)"
		}
		return "Intel GPU (QSV)"
	}
	strOut := string(output)
	if strings.Contains(strOut, "Intel") || strings.Contains(strOut, "8086") {
		for _, line := range strings.Split(strOut, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				return "Intel GPU (" + truncateLine(line, 40) + ")"
			}
		}
	}
	return "Intel GPU (QSV)"
}

func queryVAAPIRenderer() string {
	// Try vainfo first
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "vainfo")
	output, err := cmd.Output()
	if err != nil {
		// Fallback to lspci
		ctx2, cancel2 := context.WithTimeout(context.Background(), commandTimeout)
		defer cancel2()
		lspciCmd := exec.CommandContext(ctx2, "sh", "-c", "lspci -nn 2>/dev/null | grep -i 'vga\\|3d\\|display'")
		lspciOut, lspciErr := lspciCmd.Output()
		if lspciErr == nil {
			for _, line := range strings.Split(string(lspciOut), "\n") {
				line = strings.TrimSpace(line)
				if line != "" {
					return "VAAPI GPU (" + truncateLine(line, 40) + ")"
				}
			}
		}
		return "VAAPI GPU"
	}
	strOut := string(output)
	if strings.Contains(strOut, "iHD") {
		return "Intel GPU (VAAPI/iHD)"
	}
	if strings.Contains(strOut, "i965") {
		return "Intel GPU (VAAPI/i965)"
	}
	if strings.Contains(strOut, "r600") || strings.Contains(strOut, "radeonsi") {
		return "AMD GPU (VAAPI)"
	}
	return "VAAPI GPU"
}

// --- macOS-specific GPU queries ---

func queryMacOSChip() string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sysctl", "-n", "machdep.cpu.brand_string")
	output, err := cmd.Output()
	if err != nil {
		return "Apple/Intel GPU"
	}
	brand := strings.TrimSpace(string(output))
	if strings.Contains(brand, "Apple") {
		return brand + " (VideoToolbox)"
	}
	return brand + " (VideoToolbox)"
}

// --- Helpers ---

func truncateLine(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}

// GetHWAccelArgs returns the ffmpeg arguments for hardware-accelerated encoding
// based on the detected GPU type. The returned args should be used when building
// the ffmpeg command for transcoding with GPU acceleration.
//
// Strategy per GPU type:
//
//	NVENC:        -hwaccel cuda -hwaccel_output_format cuda -c:v h264_nvenc -preset p4 -tune ull -b:v 0
//	QSV:          -hwaccel qsv -c:v h264_qsv -preset medium -global_quality 23
//	VAAPI:        -vaapi_device /dev/dri/renderD128 -vf format=nv12,hwupload -c:v h264_vaapi
//	AMF:          -hwaccel d3d11va -c:v h264_amf -quality speed -usage ultralowlatency
//	VideoToolbox: -c:v h264_videotoolbox -realtime true -profile:v high
func (gi *GPUInfo) GetHWAccelArgs() []string {
	switch gi.Type {
	case GPUTypeNVENC:
		return []string{
			"-hwaccel", "cuda",
			"-hwaccel_output_format", "cuda",
			"-c:v", gi.EncoderName,
			"-preset", "p4",
			"-tune", "ull",
			"-b:v", "0",
			"-rc", "vbr",
			"-cq", "23",
		}
	case GPUTypeQSV:
		return []string{
			"-hwaccel", "qsv",
			"-c:v", gi.EncoderName,
			"-preset", "medium",
			"-global_quality", "23",
		}
	case GPUTypeVAAPI:
		// VAAPI requires device node and filter_complex for upload
		// Try common DRI device paths for compatibility
		device := getVAAPIDevice()
		return []string{
			"-vaapi_device", device,
			"-vf", "format=nv12,hwupload",
			"-c:v", gi.EncoderName,
		}
	case GPUTypeAMF:
		return []string{
			"-hwaccel", "d3d11va",
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
// Checks common paths for compatibility across different Linux distributions
// and container environments.
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
	// Fallback to the most common path; ffmpeg will produce a clear error if unavailable
	return "/dev/dri/renderD128"
}

// GetDecoderArgs returns hardware-accelerated decoder arguments if available.
// Returns nil for types where HW decode is not supported or not beneficial.
func (gi *GPUInfo) GetDecoderArgs() []string {
	switch gi.Type {
	case GPUTypeNVENC:
		// CUVID decoder for hardware-accelerated input decoding
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
