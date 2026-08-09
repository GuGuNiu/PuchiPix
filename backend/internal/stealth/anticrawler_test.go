package stealth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestRandomDelayRange verifies that the generated delay falls within
// the specified bounds, preventing either too-fast or too-slow crawling.
func TestRandomDelayRange(t *testing.T) {
	for i := 0; i < 100; i++ {
		d := RandomDelay(100, 200)
		ms := d.Milliseconds()
		assert.GreaterOrEqual(t, ms, int64(100))
		assert.LessOrEqual(t, ms, int64(200))
	}
}

// TestRandomDelayEqualBounds verifies that min == max returns the
// fixed value, avoiding a zero-length range edge case.
func TestRandomDelayEqualBounds(t *testing.T) {
	d := RandomDelay(150, 150)
	assert.Equal(t, 150*time.Millisecond, d)
}

// TestRandomDelayInvertedBounds verifies that max < min returns the
// min value gracefully, preventing negative durations.
func TestRandomDelayInvertedBounds(t *testing.T) {
	d := RandomDelay(200, 100)
	assert.Equal(t, 200*time.Millisecond, d)
}
