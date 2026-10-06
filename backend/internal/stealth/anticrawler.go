package stealth

import (
	"math/rand"
	"time"
)

const (
	PageDelayMin        = 800
	PageDelayMax        = 1500
	BatchDelayMin       = 3000
	BatchDelayMax       = 5000
	MaxRetries          = 3
	MaxGalleryPages     = 30
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
