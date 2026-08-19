package archiver

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createZip writes a plain ZIP archive with the given file entries.
func createZip(t *testing.T, zipPath string, entries map[string]string) {
	t.Helper()
	f, err := os.Create(zipPath)
	require.NoError(t, err)
	defer f.Close()

	w := zip.NewWriter(f)
	for name, content := range entries {
		entry, err := w.Create(name)
		require.NoError(t, err)
		_, err = entry.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
}

// TestExtractZip verifies that a ZIP archive is extracted to the
// destination directory with the correct file contents.
func TestExtractZip(t *testing.T) {
	tmpDir := t.TempDir()
	zipPath := filepath.Join(tmpDir, "source.zip")
	destDir := filepath.Join(tmpDir, "extracted")

	createZip(t, zipPath, map[string]string{
		"file1.txt": "content1",
		"file2.txt": "content2",
	})

	err := ExtractZip(zipPath, destDir, "")
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
