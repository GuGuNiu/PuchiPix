package infra

import (
	"crypto/rand"
	"math/big"
)

// seqCharset defines the alphanumeric space used for task sequence IDs.
// The 62-character set provides ~47 bits of entropy in 8 characters,
// keeping collision probability negligible across millions of tasks.
const seqCharset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// seqLength controls the length of generated sequence identifiers,
// balancing uniqueness with readability in CLI output and logs.
const seqLength = 8

// AllocateSeq generates a random 8-character alphanumeric identifier
// used as the human-friendly task sequence number, mirroring the
// TypeScript SeqAllocator.
func AllocateSeq() string {
	result := make([]byte, seqLength)
	for i := range result {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(seqCharset))))
		if err != nil {
			result[i] = seqCharset[0]
			continue
		}
		result[i] = seqCharset[n.Int64()]
	}
	return string(result)
}
