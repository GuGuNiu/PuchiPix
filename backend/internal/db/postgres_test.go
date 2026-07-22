package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestNewDatabaseEmptyURL verifies that an empty connection string
// is rejected immediately, preventing a confusing pgxpool parse error.
func TestNewDatabaseEmptyURL(t *testing.T) {
	_, err := NewDatabase("", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must not be empty")
}

// TestNewDatabaseInvalidURL verifies that a syntactically invalid
// connection string is caught by pgxpool.ParseConfig before any
// network connection is attempted.
func TestNewDatabaseInvalidURL(t *testing.T) {
	_, err := NewDatabase("not-a-valid-url", nil)
	assert.Error(t, err)
}

// TestStoreInterfaceSatisfied verifies that *Database satisfies the
// Store interface, ensuring the interface extraction is complete.
func TestStoreInterfaceSatisfied(t *testing.T) {
	var _ Store = (*Database)(nil)
}
