package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/infra"
)

func TestParseSQLiteTimeFormats(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string // RFC3339Nano expected
	}{
		{"rfc3339nano", "2026-08-04T12:34:56.123456789+08:00", "2026-08-04T12:34:56.123456789+08:00"},
		{"rfc3339", "2026-08-04T12:34:56Z", "2026-08-04T12:34:56Z"},
		{"driver string no mono", "2026-08-04 12:34:56.123456789 +0800 CST", "2026-08-04T12:34:56.123456789+08:00"},
		{"driver string with mono", "2026-08-04 12:34:56.123456789 +0800 CST m=+0.000000001", "2026-08-04T12:34:56.123456789+08:00"},
		{"bare no tz (datetime now)", "2026-08-03 12:32:57", "2026-08-03T12:32:57+08:00"},
		{"bare no tz with frac", "2026-08-03 12:32:57.123", "2026-08-03T12:32:57.123+08:00"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseSQLiteTime(tc.in)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got.Format(time.RFC3339Nano))
		})
	}
}

func TestParseSQLiteTimeInvalid(t *testing.T) {
	_, err := ParseSQLiteTime("not-a-time")
	assert.Error(t, err)
}

func TestSQLTimeScan(t *testing.T) {
	t.Run("string driver format", func(t *testing.T) {
		var st SQLTime
		require.NoError(t, st.Scan("2026-08-04 10:00:00 +0800 CST m=+1.5"))
		assert.True(t, st.Valid)
		assert.Equal(t, 2026, st.Time.Year())
	})

	t.Run("string rfc3339", func(t *testing.T) {
		var st SQLTime
		require.NoError(t, st.Scan("2026-08-04T10:00:00Z"))
		assert.True(t, st.Valid)
		assert.Equal(t, time.UTC, st.Time.Location())
	})

	t.Run("nil maps to invalid", func(t *testing.T) {
		var st SQLTime
		require.NoError(t, st.Scan(nil))
		assert.False(t, st.Valid)
	})

	t.Run("time.Time passthrough", func(t *testing.T) {
		now := time.Now()
		var st SQLTime
		require.NoError(t, st.Scan(now))
		assert.True(t, st.Valid)
		assert.Equal(t, now, st.Time)
	})

	t.Run("garbage errors", func(t *testing.T) {
		var st SQLTime
		assert.Error(t, st.Scan(42))
		assert.Error(t, st.Scan("garbage"))
	})
}

func TestSQLTimeValue(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		tt := time.Date(2026, 8, 4, 10, 0, 0, 0, time.UTC)
		v, err := SQLTime{Time: tt, Valid: true}.Value()
		require.NoError(t, err)
		s, ok := v.(string)
		require.True(t, ok)
		// driver encodes time.Time as String(); round trip must parse.
		back, err := ParseSQLiteTime(s)
		require.NoError(t, err)
		assert.True(t, back.Equal(tt))
	})

	t.Run("invalid is NULL", func(t *testing.T) {
		v, err := SQLTime{}.Value()
		require.NoError(t, err)
		assert.Nil(t, v)
	})
}

// TestSQLTimeRoundTripDB proves the exact production pitfall is gone:
// INSERT a time.Time (driver writes TEXT), SELECT it back through
// database/sql into SQLTime (NOT *time.Time), and the value survives.
func TestSQLTimeRoundTripDB(t *testing.T) {
	d, err := NewDatabase(filepath.Join(t.TempDir(), "time.db"), infra.NewLogger("test"))
	require.NoError(t, err)
	defer d.Close()

	ctx := context.Background()
	now := time.Now().Truncate(time.Microsecond)
	_, err = d.Exec(ctx,
		`INSERT INTO app_configs (key, value, created_at, updated_at) VALUES ('k', 'v', ?, ?)`,
		now, now)
	require.NoError(t, err)

	var key, value string
	var ca, ua SQLTime
	err = d.QueryRow(ctx, "SELECT key, value, created_at, updated_at FROM app_configs WHERE key = 'k'").Scan(&key, &value, &ca, &ua)
	require.NoError(t, err, "SQLTime must scan TEXT datetime (time.Time scan would fail)")
	assert.True(t, ca.Valid)
	assert.True(t, ua.Valid)
	assert.True(t, ca.Time.Equal(now), "round trip mismatch: %v vs %v", ca.Time, now)
	assert.True(t, ua.Time.Equal(now))
}
