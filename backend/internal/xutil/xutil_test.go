package xutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUniqueStrings(t *testing.T) {
	assert.Equal(t, []string{"a", "b", "c", "d"},
		UniqueStrings([]string{"a", "b", "a", "c", "b", "d"}, true))
}

func TestUniqueStringsFilterEmpty(t *testing.T) {
	assert.Equal(t, []string{"a", "b"},
		UniqueStrings([]string{"", "a", "", "b", "a"}, false))
}

func TestUniqueStringsEmpty(t *testing.T) {
	assert.Empty(t, UniqueStrings([]string{}, true))
	assert.Empty(t, UniqueStrings(nil, true))
}

func TestContains(t *testing.T) {
	slice := []string{"a", "b", "c"}
	assert.True(t, Contains(slice, "a"))
	assert.True(t, Contains(slice, "c"))
	assert.False(t, Contains(slice, "d"))
	assert.False(t, Contains(nil, "a"))
}
