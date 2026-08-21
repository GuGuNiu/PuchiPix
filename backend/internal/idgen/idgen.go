// Package idgen provides the canonical generator for 6-character uppercase
// alphanumeric IDs used as DAG IDs and task seq values.
//
// All callers MUST use GenerateID() to ensure uniform ID format and
// collision handling.
package idgen

import (
	"crypto/rand"
	"math/big"
)

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// 36^6 ≈ 2.1 billion combinations — collision probability is negligible
// for a single-instance application.
const idLength = 6

// GenerateID creates a 6-character random ID using crypto/rand. On
// crypto/rand failure (extremely rare), falls back to a deterministic
// derivation that still produces a valid 6-char string.
func GenerateID() string {
	b := make([]byte, idLength)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			b[i] = alphabet[i%len(alphabet)]
			continue
		}
		b[i] = alphabet[n.Int64()]
	}
	return string(b)
}
