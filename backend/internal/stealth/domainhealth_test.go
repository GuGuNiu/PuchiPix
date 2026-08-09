package stealth

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestDomainHealthTrackerGetBestDomain verifies that the healthiest
// domain is selected, preferring healthy over cooling domains.
func TestDomainHealthTrackerGetBestDomain(t *testing.T) {
	tracker := NewDomainHealthTracker()
	tracker.MarkRateLimited("blocked.com")

	domains := []string{"blocked.com", "healthy.com"}
	best := tracker.GetBestDomain(domains)
	assert.Equal(t, "healthy.com", best)
}

// TestDomainHealthTrackerGetBestDomainAllBlocked verifies that the
// first domain is returned when all are rate-limited, preventing
// a deadlock.
func TestDomainHealthTrackerGetBestDomainAllBlocked(t *testing.T) {
	tracker := NewDomainHealthTracker()
	tracker.MarkRateLimited("a.com")
	tracker.MarkRateLimited("b.com")

	domains := []string{"a.com", "b.com"}
	best := tracker.GetBestDomain(domains)
	assert.NotEmpty(t, best)
}

// TestDomainHealthTrackerMarkHealthy verifies that a previously
// rate-limited domain is restored to healthy status and can be
// selected again as the best domain.
func TestDomainHealthTrackerMarkHealthy(t *testing.T) {
	tracker := NewDomainHealthTracker()
	tracker.MarkRateLimited("example.com")
	tracker.MarkHealthy("example.com")

	best := tracker.GetBestDomain([]string{"example.com"})
	assert.Equal(t, "example.com", best)
}

// TestDomainHealthTrackerGetAllDomainsOrdered verifies that healthy
// domains come before cooling domains in the ordered list.
func TestDomainHealthTrackerGetAllDomainsOrdered(t *testing.T) {
	tracker := NewDomainHealthTracker()
	tracker.MarkRateLimited("blocked.com")

	ordered := tracker.GetAllDomainsOrdered([]string{"blocked.com", "healthy.com"})
	assert.NotEmpty(t, ordered)
	assert.Equal(t, "healthy.com", ordered[0])
}

// TestShuffleDomainsSingle verifies that a single-element slice
// is returned unchanged.
func TestShuffleDomainsSingle(t *testing.T) {
	result := ShuffleDomains([]string{"only.com"})
	assert.Len(t, result, 1)
	assert.Equal(t, "only.com", result[0])
}

// TestShuffleDomainsEmpty verifies that an empty slice is handled
// without panicking.
func TestShuffleDomainsEmpty(t *testing.T) {
	result := ShuffleDomains([]string{})
	assert.Empty(t, result)
}

// TestShuffleDomainsPreservesElements verifies that shuffling does
// not lose or duplicate any elements.
func TestShuffleDomainsPreservesElements(t *testing.T) {
	input := []string{"a.com", "b.com", "c.com", "d.com"}
	result := ShuffleDomains(input)
	assert.Len(t, result, len(input))

	seen := make(map[string]bool)
	for _, d := range result {
		assert.False(t, seen[d], "no duplicates should exist")
		seen[d] = true
	}
	for _, d := range input {
		assert.True(t, seen[d], "element %s should be present", d)
	}
}
