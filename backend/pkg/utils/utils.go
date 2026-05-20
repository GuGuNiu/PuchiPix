package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

func GenerateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func ExtractFilenameFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return GenerateID()
	}
	base := path.Base(parsed.Path)
	if base == "" || base == "." || base == "/" {
		return GenerateID()
	}
	return base
}

func SafeFilename(name string) string {
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_",
		"*", "_", "?", "_", "\"", "_",
		"<", "_", ">", "_", "|", "_",
		" ", "_",
	)
	return replacer.Replace(name)
}

func FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func FileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func DownloadFile(urlStr string, destPath string) error {
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(urlStr)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	_, err = io.Copy(out, resp.Body)
	return err
}

func FormatFileSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func EnsureDir(dir string) error {
	return os.MkdirAll(dir, 0755)
}

func JoinURL(base string, segments ...string) string {
	base = strings.TrimRight(base, "/")
	for _, seg := range segments {
		base = base + "/" + strings.TrimLeft(seg, "/")
	}
	return base
}

func TempFilePath(dir, prefix, ext string) string {
	name := fmt.Sprintf("%s_%d%s", prefix, time.Now().UnixNano(), ext)
	return filepath.Join(dir, name)
}

func IsValidURL(str string) bool {
	parsed, err := url.Parse(str)
	return err == nil && parsed.Scheme != "" && parsed.Host != ""
}

func ResolveRelativeURL(baseURL, relativeURL string) string {
	if strings.HasPrefix(relativeURL, "http://") || strings.HasPrefix(relativeURL, "https://") {
		return relativeURL
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return relativeURL
	}
	rel, err := url.Parse(relativeURL)
	if err != nil {
		return relativeURL
	}
	return base.ResolveReference(rel).String()
}
