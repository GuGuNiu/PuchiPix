package downloader

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"puchipix-backend/pkg/logger"
)

type SegmentDownloader struct {
	URL         string
	DestDir     string
	Index       int
	Retries     int
	Timeout     time.Duration
	ContentSize int64
}

type SegmentResult struct {
	Index    int
	FilePath string
	Size     int64
	Error    error
}

func NewSegmentDownloader(url string, destDir string, index int, retries int) *SegmentDownloader {
	return &SegmentDownloader{
		URL:     url,
		DestDir: destDir,
		Index:   index,
		Retries: retries,
		Timeout: 30 * time.Second,
	}
}

func (sd *SegmentDownloader) Download() SegmentResult {
	filename := fmt.Sprintf("segment_%05d.ts", sd.Index)
	destPath := filepath.Join(sd.DestDir, filename)

	if _, err := os.Stat(destPath); err == nil {
		info, _ := os.Stat(destPath)
		sd.ContentSize = info.Size()
		logger.Debug("Segment %d already exists: %s (%d bytes)", sd.Index, destPath, info.Size())
		return SegmentResult{
			Index:    sd.Index,
			FilePath: destPath,
			Size:     info.Size(),
		}
	}

	var lastErr error
	for attempt := 0; attempt <= sd.Retries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(attempt) * time.Second
			logger.Debug("Retrying segment %d (attempt %d/%d) after %v", sd.Index, attempt, sd.Retries, backoff)
			time.Sleep(backoff)
		}

		err := sd.downloadFile(destPath)
		if err == nil {
			info, _ := os.Stat(destPath)
			sd.ContentSize = info.Size()
			return SegmentResult{
				Index:    sd.Index,
				FilePath: destPath,
				Size:     info.Size(),
			}
		}
		lastErr = err
		logger.Warn("Failed to download segment %d (attempt %d/%d): %v", sd.Index, attempt, sd.Retries, err)
	}

	return SegmentResult{
		Index: sd.Index,
		Error: fmt.Errorf("segment %d failed after %d retries: %w", sd.Index, sd.Retries, lastErr),
	}
}

func (sd *SegmentDownloader) downloadFile(destPath string) error {
	tempPath := destPath + ".tmp"

	req, err := http.NewRequest("GET", sd.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	if info, err := os.Stat(tempPath); err == nil {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", info.Size()))
	}

	client := &http.Client{Timeout: sd.Timeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	flags := os.O_CREATE | os.O_WRONLY
	if resp.StatusCode == http.StatusPartialContent {
		flags |= os.O_APPEND
	} else {
		os.Remove(tempPath)
	}

	out, err := os.OpenFile(tempPath, flags, 0644)
	if err != nil {
		return err
	}
	defer out.Close()

	written, err := io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	if contentLength := resp.Header.Get("Content-Length"); contentLength != "" && resp.StatusCode != http.StatusPartialContent {
		expected, _ := strconv.ParseInt(contentLength, 10, 64)
		if expected > 0 && written < expected {
			return fmt.Errorf("incomplete download: %d < %d", written, expected)
		}
	}

	return os.Rename(tempPath, destPath)
}

func MergeSegments(segDir string, outputPath string, segmentCount int) error {
	out, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer out.Close()

	for i := 0; i < segmentCount; i++ {
		segPath := filepath.Join(segDir, fmt.Sprintf("segment_%05d.ts", i))
		if _, err := os.Stat(segPath); os.IsNotExist(err) {
			logger.Warn("Segment %d not found at %s, skipping", i, segPath)
			continue
		}

		in, err := os.Open(segPath)
		if err != nil {
			return fmt.Errorf("failed to open segment %d: %w", i, err)
		}

		_, err = io.Copy(out, in)
		in.Close()
		if err != nil {
			return fmt.Errorf("failed to copy segment %d: %w", i, err)
		}
	}

	return nil
}

func CleanupSegments(segDir string) error {
	entries, err := os.ReadDir(segDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "segment_") {
			os.Remove(filepath.Join(segDir, entry.Name()))
		}
	}
	return nil
}
