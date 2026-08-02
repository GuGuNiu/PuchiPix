package dbconfig

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestGetDBPathDefault verifies that the default path is returned
// when DB_PATH is not set.
func TestGetDBPathDefault(t *testing.T) {
	os.Unsetenv("DB_PATH")

	p := GetDBPath()
	assert.NotEmpty(t, p)
	assert.Equal(t, DefaultDBPath, p)
}

// TestGetDBPathOverride verifies that DB_PATH takes precedence
// over the default, allowing per-environment customization.
func TestGetDBPathOverride(t *testing.T) {
	t.Setenv("DB_PATH", "/tmp/test_puchipix.db")

	p := GetDBPath()
	assert.Equal(t, "/tmp/test_puchipix.db", p)
}

// TestGetDSNReturnsPath verifies that GetDSN returns the same
// value as GetDBPath for database/sql compatibility.
func TestGetDSNReturnsPath(t *testing.T) {
	os.Unsetenv("DB_PATH")

	dsn := GetDSN()
	assert.Equal(t, GetDBPath(), dsn)
}

// TestGetDSNWithDBPath verifies that DB_PATH is reflected in
// the DSN returned by GetDSN.
func TestGetDSNWithDBPath(t *testing.T) {
	expected := "/tmp/custom_puchipix.db"
	t.Setenv("DB_PATH", expected)

	assert.Equal(t, expected, GetDSN())
}

// TestConnectionString verifies the alias returns the DB path.
func TestConnectionString(t *testing.T) {
	t.Setenv("DB_PATH", "/tmp/alias_test.db")

	assert.Equal(t, "/tmp/alias_test.db", ConnectionString())
}
