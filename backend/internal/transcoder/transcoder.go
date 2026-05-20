package transcoder

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"puchipix-backend/pkg/logger"
)

func TranscodeTS(inputDir string, outputPath string, segmentCount int) error {
	concatFile := filepath.Join(inputDir, "concat.txt")
	var lines []string
	for i := 0; i < segmentCount; i++ {
		segPath := filepath.Join(inputDir, fmt.Sprintf("segment_%05d.ts", i))
		if _, err := os.Stat(segPath); err == nil {
			absPath, _ := filepath.Abs(segPath)
			lines = append(lines, fmt.Sprintf("file '%s'", strings.ReplaceAll(absPath, "'", "'\\''")))
		}
	}

	if len(lines) == 0 {
		return fmt.Errorf("no segments found in %s", inputDir)
	}

	if err := os.WriteFile(concatFile, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		return fmt.Errorf("failed to write concat file: %w", err)
	}
	defer os.Remove(concatFile)

	args := []string{
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
		"-y",
		outputPath,
	}

	cmd := exec.Command("ffmpeg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.Error("FFmpeg transcoding failed: %v\nOutput: %s", err, string(output))
		return fmt.Errorf("ffmpeg transcoding failed: %w\n%s", err, string(output))
	}

	logger.Info("Transcoding completed: %s -> %s", inputDir, outputPath)
	return nil
}

func ProbeDuration(filePath string) (float64, error) {
	args := []string{
		"-i", filePath,
		"-show_entries", "format=duration",
		"-v", "quiet",
		"-of", "csv=p=0",
	}

	cmd := exec.Command("ffprobe", args...)
	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	var duration float64
	if _, err := fmt.Sscanf(strings.TrimSpace(string(output)), "%f", &duration); err != nil {
		return 0, fmt.Errorf("failed to parse duration: %w", err)
	}

	return duration, nil
}

func ProbeResolution(filePath string) (string, error) {
	args := []string{
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=s=x:p=0",
		filePath,
	}

	cmd := exec.Command("ffprobe", args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("ffprobe failed: %w", err)
	}

	resolution := strings.TrimSpace(string(output))
	if resolution == "" {
		return "unknown", nil
	}
	return resolution, nil
}

func CheckFFmpeg() error {
	cmd := exec.Command("ffmpeg", "-version")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}
	return nil
}

func CheckFFprobe() error {
	cmd := exec.Command("ffprobe", "-version")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffprobe not found: %w", err)
	}
	return nil
}
