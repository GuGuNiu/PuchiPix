package image

import (
	"bytes"
	"crypto/md5"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
)

const thumbnailQuality = 80
const maxThumbnailWidth = 1200
const thumbnailCacheRoot = ".." + string(filepath.Separator) + "data" + string(filepath.Separator) + "thumbnails"

// ServeResizedImage reads an image from disk, resizes it to the requested
// width, and writes the result. Generated thumbnails are cached under
// data/thumbnails/{XX}/{hash}.jpg using hex-sharded directories.
func ServeResizedImage(w http.ResponseWriter, r *http.Request, absPath string, targetWidth int) {
	if targetWidth <= 0 {
		http.ServeFile(w, r, absPath)
		return
	}
	if targetWidth > maxThumbnailWidth {
		targetWidth = maxThumbnailWidth
	}

	cachePath := ThumbnailCachePath(absPath, targetWidth)
	if _, err := os.Stat(cachePath); err == nil {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, cachePath)
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		http.ServeFile(w, r, absPath)
		return
	}
	defer f.Close()

	src, format, err := image.Decode(f)
	if err != nil {
		http.ServeFile(w, r, absPath)
		return
	}

	srcBounds := src.Bounds()
	srcW, srcH := srcBounds.Dx(), srcBounds.Dy()
	if srcW <= targetWidth && srcH <= targetWidth {
		http.ServeFile(w, r, absPath)
		return
	}

	newW := targetWidth
	newH := int(float64(srcH) * float64(targetWidth) / float64(srcW))
	if newH < 1 {
		newH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, srcBounds, draw.Over, nil)

	var buf bytes.Buffer
	contentType := ""
	switch format {
	case "jpeg":
		contentType = "image/jpeg"
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: thumbnailQuality}); err != nil {
			http.ServeFile(w, r, absPath)
			return
		}
	case "png":
		contentType = "image/png"
		if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, dst); err != nil {
			http.ServeFile(w, r, absPath)
			return
		}
	default:
		http.ServeFile(w, r, absPath)
		return
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err == nil {
		_ = os.WriteFile(cachePath, buf.Bytes(), 0644)
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	w.Header().Set("X-Thumbnail-Size", fmt.Sprintf("%dx%d", newW, newH))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, &buf)
}

// ThumbnailCachePath computes the disk cache path using hex-sharded
// directories (00..ff) derived from an MD5 hash of the source path + width.
func ThumbnailCachePath(absPath string, width int) string {
	key := fmt.Sprintf("%s:%d", filepath.ToSlash(absPath), width)
	hash := fmt.Sprintf("%x", md5.Sum([]byte(key)))
	return filepath.Join(thumbnailCacheRoot, hash[:2], hash[2:]+".jpg")
}

// QueryInt extracts an integer query parameter with a fallback default.
func QueryWidth(r *http.Request) int {
	v := r.URL.Query().Get("width")
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// ResolveDataPath resolves a stored local path to an absolute filesystem
// path that the API can serve. It handles three path formats that may
// exist in the database.
func ResolveDataPath(storedPath string) string {
	if storedPath == "" {
		return ""
	}

	if filepath.IsAbs(storedPath) {
		dataRoot, _ := filepath.Abs(filepath.Join("..", "data"))
		abs := filepath.Clean(storedPath)
		if strings.HasPrefix(filepath.ToSlash(abs)+"/", filepath.ToSlash(dataRoot)+"/") {
			return abs
		}
		return ""
	}

	clean := strings.TrimPrefix(filepath.FromSlash(storedPath), "data"+string(filepath.Separator))
	clean = strings.TrimPrefix(clean, "data/")

	fullPath := filepath.Join("..", "data", clean)

	abs, err := filepath.Abs(fullPath)
	if err != nil {
		return ""
	}
	dataRoot, _ := filepath.Abs(filepath.Join("..", "data"))
	if !strings.HasPrefix(filepath.ToSlash(abs)+"/", filepath.ToSlash(dataRoot)+"/") {
		return ""
	}
	return abs
}
