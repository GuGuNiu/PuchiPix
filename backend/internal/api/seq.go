package api

import (
	"crypto/rand"
	"math/big"
)

// seqAlphabet is the character set for display IDs.
// 36 characters (A-Z + 0-9) — same as the legacy TypeScript format.
const seqAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// seqLength is the number of characters in a generated display ID.
// 36^6 ≈ 2.1 billion combinations — collision probability is negligible
// for a single-instance application.
const seqLength = 6

// newSeq generates a 6-character random display ID using crypto/rand.
// The alphabet is uppercase letters + digits, matching the legacy
// TypeScript backend format (e.g. "Z6D28E", "PURAPU").
//
// Collision risk: with 36^6 = 2,176,782,336 possible values, the
// birthday problem probability of collision at 50,000 tasks is ~0.06%.
// Combined with a UNIQUE constraint in the database, retry-on-collision
// makes this safe for practical use.
func newSeq() string {
	b := make([]byte, seqLength)
	max := big.NewInt(int64(len(seqAlphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			// Fallback: non-crypto random is acceptable for display IDs
			b[i] = seqAlphabet[i%len(seqAlphabet)]
			continue
		}
		b[i] = seqAlphabet[n.Int64()]
	}
	return string(b)
}
