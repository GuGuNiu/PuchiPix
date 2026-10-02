// Package idgen generates the 6-character uppercase alphanumeric IDs used as
// DAG IDs and task seq values.
package idgen

import (
	"crypto/rand"
	"math/big"
)

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// 36^6 is about 2.1 billion combinations, so collisions are negligible for a
// single-instance application.
const idLength = 6

// GenerateID returns idLength random characters. When crypto/rand fails the
// position is filled from a fixed offset instead, so the result always has the
// required length.
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
