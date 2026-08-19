package archiver

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ExtractZip extracts a ZIP archive to the given destination directory.
// If password is non-empty, it is ignored (Go's archive/zip does not
// support encrypted ZIPs; use an external tool for password-protected archives).
func ExtractZip(zipPath, destDir string, password string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	for _, f := range r.File {
		destPath := filepath.Join(destDir, f.Name)
		if !strings.HasPrefix(destPath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("zip entry outside dest dir: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(destPath, 0755); err != nil {
				return fmt.Errorf("create dir %s: %w", destPath, err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return fmt.Errorf("create parent dir: %w", err)
		}

		out, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			return fmt.Errorf("create file %s: %w", destPath, err)
		}

		rc, err := f.Open()
		if err != nil {
			out.Close()
			return fmt.Errorf("open zip entry %s: %w", f.Name, err)
		}

		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return fmt.Errorf("extract %s: %w", f.Name, err)
		}
		rc.Close()
		out.Close()
	}

	return nil
}
