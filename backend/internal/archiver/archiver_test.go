package archiver

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGenerateCbzBytes verifies that a CBZ archive is created with
// zero-padded image names and an embedded ComicInfo.xml.
func TestGenerateCbzBytes(t *testing.T) {
	images := []CbzImageEntry{
		{Filename: "page1.jpg", Data: []byte("img1")},
		{Filename: "page2.jpg", Data: []byte("img2")},
	}
	meta := CbzMetadata{
		Title:       "Test Gallery",
		Protagonist: "Test Person",
		Tags:        []string{"tag1", "tag2"},
		ImageCount:  2,
	}

	data, err := GenerateCbzBytes(images, meta)
	require.NoError(t, err)
	assert.NotEmpty(t, data)

	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)

	var hasComicInfo bool
	var hasPaddedImage bool
	for _, f := range r.File {
		if f.Name == "ComicInfo.xml" {
			hasComicInfo = true
		}
		if strings.HasPrefix(f.Name, "00001") {
			hasPaddedImage = true
		}
	}
	assert.True(t, hasComicInfo, "CBZ should contain ComicInfo.xml")
	assert.True(t, hasPaddedImage, "CBZ should use zero-padded filenames")
}

// TestGenerateCbzBytesEmpty verifies that a CBZ with no images still
// contains the ComicInfo.xml, allowing metadata-only archives.
func TestGenerateCbzBytesEmpty(t *testing.T) {
	data, err := GenerateCbzBytes([]CbzImageEntry{}, CbzMetadata{Title: "Empty", ImageCount: 0})
	require.NoError(t, err)

	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)

	var hasComicInfo bool
	for _, f := range r.File {
		if f.Name == "ComicInfo.xml" {
			hasComicInfo = true
		}
	}
	assert.True(t, hasComicInfo)
}

// TestGenerateCbzFile verifies that a CBZ file is written to disk
// and can be read back.
func TestGenerateCbzFile(t *testing.T) {
	tmpDir := t.TempDir()
	outputPath := filepath.Join(tmpDir, "test.cbz")

	images := []CbzImageEntry{
		{Filename: "1.jpg", Data: []byte("img1")},
	}
	err := GenerateCbzFile(images, CbzMetadata{Title: "Test", ImageCount: 1}, outputPath)
	require.NoError(t, err)

	info, err := os.Stat(outputPath)
	require.NoError(t, err)
	assert.Greater(t, info.Size(), int64(0))
}

// TestGenerateZipBytes verifies that a plain ZIP archive is created
// with the correct file entries.
func TestGenerateZipBytes(t *testing.T) {
	images := []ZipImageEntry{
		{Filename: "file1.jpg", Data: []byte("data1")},
		{Filename: "file2.jpg", Data: []byte("data2")},
	}

	data, err := GenerateZipBytes(images)
	require.NoError(t, err)
	assert.NotEmpty(t, data)

	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	assert.Len(t, r.File, 2)
}

// TestGenerateZipFile verifies that a ZIP file is written to disk.
func TestGenerateZipFile(t *testing.T) {
	tmpDir := t.TempDir()
	outputPath := filepath.Join(tmpDir, "test.zip")

	images := []ZipImageEntry{
		{Filename: "a.jpg", Data: []byte("aaa")},
	}
	err := GenerateZipFile(images, outputPath)
	require.NoError(t, err)

	info, err := os.Stat(outputPath)
	require.NoError(t, err)
	assert.Greater(t, info.Size(), int64(0))
}

// TestExtractZip verifies that a ZIP archive is extracted to the
// destination directory with the correct file contents.
func TestExtractZip(t *testing.T) {
	tmpDir := t.TempDir()
	zipPath := filepath.Join(tmpDir, "source.zip")
	destDir := filepath.Join(tmpDir, "extracted")

	images := []ZipImageEntry{
		{Filename: "file1.txt", Data: []byte("content1")},
		{Filename: "file2.txt", Data: []byte("content2")},
	}
	err := GenerateZipFile(images, zipPath)
	require.NoError(t, err)

	err = ExtractZip(zipPath, destDir, "")
	require.NoError(t, err)

	content1, err := os.ReadFile(filepath.Join(destDir, "file1.txt"))
	require.NoError(t, err)
	assert.Equal(t, "content1", string(content1))

	content2, err := os.ReadFile(filepath.Join(destDir, "file2.txt"))
	require.NoError(t, err)
	assert.Equal(t, "content2", string(content2))
}

// TestExtractZipNonExistent verifies that extracting a non-existent
// file returns an error.
func TestExtractZipNonExistent(t *testing.T) {
	err := ExtractZip("/nonexistent/path.zip", t.TempDir(), "")
	assert.Error(t, err)
}

// TestEscapeXML verifies that special XML characters are properly
// escaped, preventing XML injection in ComicInfo.xml.
func TestEscapeXML(t *testing.T) {
	assert.Equal(t, "&amp;", escapeXML("&"))
	assert.Equal(t, "&lt;", escapeXML("<"))
	assert.Equal(t, "&gt;", escapeXML(">"))
	assert.Equal(t, "&quot;", escapeXML(`"`))
	assert.Equal(t, "&apos;", escapeXML("'"))
}

// TestGenerateComicInfoXML verifies that the ComicInfo.xml contains
// the expected fields when all metadata is provided.
func TestGenerateComicInfoXML(t *testing.T) {
	xml := generateComicInfoXML(CbzMetadata{
		Title:       "Test & Gallery",
		Protagonist: "Alice",
		Tags:        []string{"tag1", "tag2"},
		ImageCount:  42,
	})

	assert.Contains(t, xml, "Test &amp; Gallery")
	assert.Contains(t, xml, "<Writer>Alice</Writer>")
	assert.Contains(t, xml, "tag1, tag2")
	assert.Contains(t, xml, "<PageCount>42</PageCount>")
}

// TestGenerateComicInfoXMLMinimal verifies that the ComicInfo.xml
// is valid even when optional fields are empty.
func TestGenerateComicInfoXMLMinimal(t *testing.T) {
	xml := generateComicInfoXML(CbzMetadata{
		Title:      "Minimal",
		ImageCount: 0,
	})

	assert.Contains(t, xml, "<Title>Minimal</Title>")
	assert.NotContains(t, xml, "<Writer>")
	assert.NotContains(t, xml, "<Tags>")
}
