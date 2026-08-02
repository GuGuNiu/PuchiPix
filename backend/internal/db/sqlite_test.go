package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestNewDatabaseEmptyPath verifies that an empty database path
// is rejected immediately.
func TestNewDatabaseEmptyPath(t *testing.T) {
	_, err := NewDatabase("", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must not be empty")
}

// TestStoreInterfaceSatisfied verifies that *Database satisfies the
// Store interface, ensuring the interface extraction is complete.
func TestStoreInterfaceSatisfied(t *testing.T) {
	var _ Store = (*Database)(nil)
}
