package archiver

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// CbzMetadata carries the metadata embedded in a CBZ archive's
// ComicInfo.xml file for comic reader compatibility.
type CbzMetadata struct {
	Title       string
	Protagonist string
	Tags        []string
	ImageCount  int
}

// CbzImageEntry represents a single image to be added to a CBZ archive.
type CbzImageEntry struct {
	Filename string
	Data     []byte
}

// ZipImageEntry represents a single file to be added to a plain ZIP archive.
type ZipImageEntry struct {
	Filename string
	Data     []byte
}

// ArchiveFormat identifies the output container type.
type ArchiveFormat string

const (
	FormatCbz ArchiveFormat = "cbz"
	FormatZip ArchiveFormat = "zip"
)

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, `'`, "&apos;")
	return s
}

func generateComicInfoXML(meta CbzMetadata) string {
	tags := ""
	if len(meta.Tags) > 0 {
		tags = fmt.Sprintf("  <Tags>%s</Tags>\n", escapeXML(strings.Join(meta.Tags, ", ")))
	}
	writer := ""
	if meta.Protagonist != "" {
		writer = fmt.Sprintf("  <Writer>%s</Writer>\n", escapeXML(meta.Protagonist))
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>%s</Title>
%s  <PageCount>%d</PageCount>
%s</ComicInfo>
`, escapeXML(meta.Title), writer, meta.ImageCount, tags)
}

// GenerateCbzBytes creates a CBZ archive in memory with zero-padded image
// filenames and an embedded ComicInfo.xml.
func GenerateCbzBytes(images []CbzImageEntry, metadata CbzMetadata) ([]byte, error) {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	for i, entry := range images {
		paddedIndex := fmt.Sprintf("%05d", i+1)
		ext := filepath.Ext(entry.Filename)
		if ext == "" {
			ext = ".jpg"
		}
		name := paddedIndex + ext
		f, err := w.Create(name)
		if err != nil {
			return nil, fmt.Errorf("create zip entry %s: %w", name, err)
		}
		if _, err := f.Write(entry.Data); err != nil {
			return nil, fmt.Errorf("write zip entry %s: %w", name, err)
		}
	}

	comicInfo := generateComicInfoXML(metadata)
	f, err := w.Create("ComicInfo.xml")
	if err != nil {
		return nil, fmt.Errorf("create ComicInfo.xml: %w", err)
	}
	if _, err := f.Write([]byte(comicInfo)); err != nil {
		return nil, fmt.Errorf("write ComicInfo.xml: %w", err)
	}

	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("close zip writer: %w", err)
	}
	return buf.Bytes(), nil
}

// GenerateCbzFile writes a CBZ archive to disk at the given path.
func GenerateCbzFile(images []CbzImageEntry, metadata CbzMetadata, outputPath string) error {
	data, err := GenerateCbzBytes(images, metadata)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, data, 0644)
}

// GenerateZipBytes creates a plain ZIP archive in memory from file entries.
func GenerateZipBytes(images []ZipImageEntry) ([]byte, error) {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	for _, entry := range images {
		name := filepath.Base(entry.Filename)
		if name == "" {
			name = entry.Filename
		}
		f, err := w.Create(name)
		if err != nil {
			return nil, fmt.Errorf("create zip entry %s: %w", name, err)
		}
		if _, err := f.Write(entry.Data); err != nil {
			return nil, fmt.Errorf("write zip entry %s: %w", name, err)
		}
	}

	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("close zip writer: %w", err)
	}
	return buf.Bytes(), nil
}

// GenerateZipFile writes a plain ZIP archive to disk at the given path.
func GenerateZipFile(images []ZipImageEntry, outputPath string) error {
	data, err := GenerateZipBytes(images)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, data, 0644)
}

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
