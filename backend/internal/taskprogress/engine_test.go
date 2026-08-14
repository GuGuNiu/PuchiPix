package taskprogress

import (
	"context"
	"path/filepath"
	"testing"

	"backend/internal/db"
	"backend/internal/infra"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestDatabase opens a throwaway SQLite database in the OS temp dir.
func newTestDatabase(t *testing.T) *db.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "progress-test.db")
	database, err := db.NewDatabase(path, infra.NewLogger("TestDB"))
	require.NoError(t, err)
	t.Cleanup(func() { database.Close() })
	return database
}

// TestDownloadPhaseTransitions verifies legal and illegal transitions of
// the download-phase state machine.
func TestDownloadPhaseTransitions(t *testing.T) {
	valid := [][2]DownloadPhase{
		{PhasePending, PhaseScanning},
		{PhasePending, PhaseInProgress},
		{PhasePending, PhaseFailed},
		{PhaseScanning, PhaseInProgress},
		{PhaseScanning, PhaseComplete},
		{PhaseScanning, PhaseFailed},
		{PhaseInProgress, PhaseVerifying},
		{PhaseInProgress, PhaseComplete},
		{PhaseInProgress, PhaseFailed},
		{PhaseInProgress, PhaseScanning},
		{PhaseVerifying, PhaseComplete},
		{PhaseVerifying, PhaseFailed},
		{PhaseVerifying, PhaseInProgress},
		{PhaseFailed, PhaseScanning},
		{PhaseFailed, PhaseInProgress},
	}
	for _, pair := range valid {
		assert.True(t, CanTransitionDownloadPhase(pair[0], pair[1]),
			"expected %s -> %s to be legal", pair[0], pair[1])
	}

	illegal := [][2]DownloadPhase{
		{PhasePending, PhaseComplete},
		{PhaseComplete, PhaseInProgress},
		{PhaseComplete, PhaseFailed},
		{PhaseFailed, PhaseComplete},
		{PhaseInProgress, PhasePending},
		{PhaseVerifying, PhasePending},
		{PhaseScanning, PhasePending},
	}
	for _, pair := range illegal {
		assert.False(t, CanTransitionDownloadPhase(pair[0], pair[1]),
			"expected %s -> %s to be illegal", pair[0], pair[1])
	}
}

// TestSetPhaseEnforcesTransitions verifies SetPhase rejects illegal moves.
func TestSetPhaseEnforcesTransitions(t *testing.T) {
	e := NewEngine(nil)

	// Gallery 1: forward path, then a failed retry that re-enters scanning.
	require.NoError(t, e.SetPhase(1, PhaseScanning))
	require.NoError(t, e.SetPhase(1, PhaseInProgress))
	require.NoError(t, e.SetPhase(1, PhaseFailed))
	require.NoError(t, e.SetPhase(1, PhaseScanning))

	// Gallery 2: reaching the terminal COMPLETE state blocks further moves.
	require.NoError(t, e.SetPhase(2, PhaseScanning))
	require.NoError(t, e.SetPhase(2, PhaseInProgress))
	require.NoError(t, e.SetPhase(2, PhaseComplete))
	// PhaseComplete is terminal; no outgoing transitions.
	assert.Error(t, e.SetPhase(2, PhaseFailed))
	assert.Error(t, e.SetPhase(2, PhaseInProgress))
}

// TestSaveLoadProgress verifies checkpoint round-trip: registered file
// statuses and the phase survive SaveProgress → LoadProgress.
func TestSaveLoadProgress(t *testing.T) {
	// Use an in-memory database to validate the persistence layer.
	database := newTestDatabase(t)
	e := NewEngine(nil)
	e.SetDatabase(database)

	require.NoError(t, e.SetPhase(42, PhaseInProgress))
	e.RegisterFiles(42, []FileProgress{
		{FileIndex: 0, FileType: FileTypeImage, FileURL: "u0", Status: FileCompleted, LocalPath: "/tmp/0.jpg", FileSize: 100},
		{FileIndex: 1, FileType: FileTypeImage, FileURL: "u1", Status: FilePending},
		{FileIndex: 2, FileType: FileTypeImage, FileURL: "u2", Status: FileFailed, ErrorMsg: "boom"},
	})
	require.NoError(t, e.SaveProgress(context.Background(), database, 42))

	// New engine instance simulates a restart.
	e2 := NewEngine(nil)
	e2.SetDatabase(database)
	require.NoError(t, e2.LoadProgress(context.Background(), database, 42))

	assert.Equal(t, PhaseInProgress, e2.GetPhase(42))
	summary := e2.GetSummary(42)
	assert.Equal(t, 3, summary.TotalFiles)
	assert.Equal(t, 1, summary.CompletedFiles)
	assert.Equal(t, 1, summary.FailedFiles)

	failed := e2.GetFailedFiles(42)
	require.Len(t, failed, 1)
	assert.Equal(t, 2, failed[0].FileIndex)
	assert.Equal(t, "boom", failed[0].ErrorMsg)
}
