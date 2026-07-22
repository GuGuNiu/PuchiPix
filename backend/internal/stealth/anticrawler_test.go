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

// TestGaussianDelayNonNegative verifies that the Gaussian delay
// never returns a negative duration, preventing time.Sleep panics.
func TestGaussianDelayNonNegative(t *testing.T) {
	for i := 0; i < 1000; i++ {
		d := GaussianDelay(500, 1000)
		assert.GreaterOrEqual(t, d.Milliseconds(), int64(0))
	}
}

// TestBackoffDelayExponential verifies that backoff delays increase
// exponentially with retry count, up to the maximum cap.
func TestBackoffDelayExponential(t *testing.T) {
	d0 := BackoffDelay(0, 100, 10000)
	d1 := BackoffDelay(1, 100, 10000)
	d5 := BackoffDelay(5, 100, 10000)

	assert.Greater(t, d1.Milliseconds(), d0.Milliseconds())
	assert.LessOrEqual(t, d5.Milliseconds(), int64(10000), "should be capped at maxDelay")
}

// TestBackoffDelayCapped verifies that the backoff never exceeds
// the maximum delay, even with a very high retry count.
func TestBackoffDelayCapped(t *testing.T) {
	d := BackoffDelay(100, 1000, 5000)
	assert.LessOrEqual(t, d.Milliseconds(), int64(5000))
}
