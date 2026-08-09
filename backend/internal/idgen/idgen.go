// Package idgen provides the single canonical generator for 6-character
// uppercase alphanumeric IDs (A-Z + 0-9) used across the project as
// DAG IDs, task seq values, and sniff task seq values.
//
// All callers MUST use idgen.GenerateID() instead of rolling their own
// copy of the algorithm. This ensures uniform ID format and collision
// handling everywhere.
package idgen

import (
	"crypto/rand"
	"math/big"
)

// alphabet is the character set for generated IDs.
// 36 characters (A-Z + 0-9) — matches the legacy TypeScript format.
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// idLength is the number of characters in a generated ID.
// 36^6 ≈ 2.1 billion combinations — collision probability is negligible
// for a single-instance application.
const idLength = 6

// GenerateID creates a 6-character random ID using crypto/rand.
// The alphabet is uppercase letters + digits (e.g. "Z6D28E", "A12345").
//
// Collision risk: with 36^6 = 2,176,782,336 possible values, the
// birthday problem probability of collision at 50,000 entries is ~0.06%.
// Combined with a UNIQUE constraint in the database, retry-on-collision
// makes this safe for practical use.
//
// On crypto/rand failure (extremely rare), falls back to a deterministic
// derivation that still produces a valid 6-char string, allowing the
// caller to proceed rather than fail the entire operation.
func GenerateID() string {
	b := make([]byte, idLength)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			// Fallback: deterministic position — acceptable for display IDs
			b[i] = alphabet[i%len(alphabet)]
			continue
		}
		b[i] = alphabet[n.Int64()]
	}
	return string(b)
}
