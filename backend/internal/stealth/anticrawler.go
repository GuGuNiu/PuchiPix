package stealth

import (
	"math"
	"math/rand"
	"time"
)

const (
	PageDelayMin     = 800
	PageDelayMax     = 1500
	BatchDelayMin    = 3000
	BatchDelayMax    = 5000
	MaxRetries       = 3
	MaxGalleryPages  = 30
	GalleryHTTPDelayMin = 200
	GalleryHTTPDelayMax = 400
)

// RandomDelay returns a random duration between min and max milliseconds.
func RandomDelay(minMs, maxMs int) time.Duration {
	if maxMs <= minMs {
		return time.Duration(minMs) * time.Millisecond
	}
	return time.Duration(minMs+rand.Intn(maxMs-minMs)) * time.Millisecond
}

// Sleep pauses execution for a random duration between min and max.
func Sleep(minMs, maxMs int) {
	time.Sleep(RandomDelay(minMs, maxMs))
}

// GaussianDelay returns a delay drawn from a normal distribution,
// simulating human-like timing variability.
func GaussianDelay(meanMs, stddevMs int) time.Duration {
	u1 := rand.Float64()
	if u1 < 1e-10 {
		u1 = 1e-10
	}
	u2 := rand.Float64()
	z := math.Sqrt(-2*math.Log(u1)) * math.Cos(2*math.Pi*u2)
	return time.Duration(math.Max(0, math.Round(float64(meanMs)+z*float64(stddevMs)))) * time.Millisecond
}

// BackoffDelay returns an exponential backoff delay with jitter,
// suitable for retry logic.
func BackoffDelay(retryCount int, baseDelayMs, maxDelayMs int) time.Duration {
	raw := float64(baseDelayMs) * math.Pow(2, float64(retryCount))
	jitter := raw * 0.2 * (rand.Float64()*2 - 1)
	result := math.Max(0, raw+jitter)
	if result > float64(maxDelayMs) {
		result = float64(maxDelayMs)
	}
	return time.Duration(math.Round(result)) * time.Millisecond
}
