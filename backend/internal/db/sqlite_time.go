package db

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// timeTextLayout matches the modernc.org/sqlite driver's encoding of
// time.Time arguments, which is Go's time.Time.String() format:
// "2006-01-02 15:04:05.999999999 -0700 MST". The driver does not use RFC3339,
// so database/sql cannot scan such TEXT values into a *time.Time directly.
//
// Every rows.Scan target for a SQLite time column (*_at) must be SQLTime or
// string: scanning into time.Time or *time.Time returns a Scan error that
// callers commonly swallow with continue, leaving list endpoints empty.
const timeTextLayout = "2006-01-02 15:04:05.999999999 -0700 MST"

// timeTextLayoutNoTZ matches bare "2006-01-02 15:04:05" datetimes
// produced by SQLite datetime('now') and legacy Go Format writes.
const timeTextLayoutNoTZ = "2006-01-02 15:04:05"

// ParseSQLiteTime decodes a timestamp read from a SQLite TEXT datetime
// column. Three encodings occur in stored data:
//   - RFC3339Nano, from explicit writes.
//   - The driver's time.Time.String() format, optionally carrying a
//     monotonic " m=+..." suffix, from time.Time arguments passed through
//     modernc.org/sqlite.
//   - A bare "2006-01-02 15:04:05" with no timezone, from SQLite
//     datetime('now') and legacy Go Format writes. Such rows break both a
//     direct time.Time scan and a String()-only parser.
//
// This is the single source of truth for SQLite time parsing; other packages
// delegate here rather than re-implementing the layout fallbacks.
func ParseSQLiteTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	if i := strings.Index(s, " m="); i >= 0 {
		s = s[:i]
	}
	if t, err := time.Parse(timeTextLayout, s); err == nil {
		return t, nil
	}
	// Bare datetime without timezone: assume local time (legacy Go
	// Format writes and datetime('now') both end up here; callers that
	// need UTC should normalize afterwards).
	return time.ParseInLocation(timeTextLayoutNoTZ, s, time.Local)
}

// SQLTime scans SQLite TEXT datetime columns into a time.Time. Use it as
// the scan target for *_at columns instead of *time.Time, which the
// modernc driver cannot populate from TEXT values.
//
// Usage (preferred):
//
//	var ca, ua db.SQLTime
//	rows.Scan(&..., &ca, &ua)
//	t := ca.Time // time.Time value
//
// It also implements driver.Valuer so it can be used as an INSERT/UPDATE
// argument, and MarshalJSON/UnmarshalJSON so it round-trips through API
// responses.
type SQLTime struct {
	Time  time.Time
	Valid bool
}

func (t *SQLTime) Scan(value any) error {
	switch v := value.(type) {
	case nil:
		t.Time, t.Valid = time.Time{}, false
	case string:
		tv, err := ParseSQLiteTime(v)
		if err != nil {
			return fmt.Errorf("SQLTime scan: parse %q: %w", v, err)
		}
		t.Time, t.Valid = tv, true
	case time.Time:
		t.Time, t.Valid = v, true
	default:
		return fmt.Errorf("SQLTime scan: unsupported driver value type %T", value)
	}
	return nil
}

// Value implements driver.Valuer. A zero SQLTime (Valid=false) maps to
// NULL; otherwise the value is encoded the same way the driver encodes
// time.Time (String() format), so a round trip stays consistent.
func (t SQLTime) Value() (driver.Value, error) {
	if !t.Valid {
		return nil, nil
	}
	return t.Time.String(), nil
}

// MarshalJSON emits the time in RFC3339 format when valid, otherwise null.
func (t SQLTime) MarshalJSON() ([]byte, error) {
	if !t.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(t.Time)
}

// UnmarshalJSON accepts an RFC3339 string or null.
func (t *SQLTime) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		t.Time, t.Valid = time.Time{}, false
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	tv, err := ParseSQLiteTime(s)
	if err != nil {
		return err
	}
	t.Time, t.Valid = tv, true
	return nil
}
