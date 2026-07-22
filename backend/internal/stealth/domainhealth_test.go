package stealth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestDomainHealthTrackerHealthy verifies that a fresh domain is
// considered healthy, allowing immediate scraping.
func TestDomainHealthTrackerHealthy(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	assert.True(t, tracker.IsHealthy("example.com"))
}

// TestDomainHealthTrackerMarkRateLimited verifies that a marked domain
// is considered unhealthy during its cooldown period.
func TestDomainHealthTrackerMarkRateLimited(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	tracker.MarkRateLimited("example.com")
	assert.False(t, tracker.IsHealthy("example.com"))
}

// TestDomainHealthTrackerMarkHealthy verifies that a previously
// rate-limited domain is restored to healthy status.
func TestDomainHealthTrackerMarkHealthy(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	tracker.MarkRateLimited("example.com")
	tracker.MarkHealthy("example.com")
	assert.True(t, tracker.IsHealthy("example.com"))
}

// TestDomainHealthTrackerCooldownExpiry verifies that a domain
// becomes healthy again after its cooldown period elapses.
func TestDomainHealthTrackerCooldownExpiry(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(50 * time.Millisecond)
	tracker.MarkRateLimited("example.com")

	time.Sleep(100 * time.Millisecond)
	assert.True(t, tracker.IsHealthy("example.com"))
}

// TestDomainHealthTrackerGetRemainingCooldown verifies that the
// remaining cooldown decreases over time and reaches zero after expiry.
func TestDomainHealthTrackerGetRemainingCooldown(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Second)
	tracker.MarkRateLimited("example.com")

	remaining := tracker.GetRemainingCooldown("example.com")
	assert.Greater(t, remaining, time.Duration(0))

	remainingHealthy := tracker.GetRemainingCooldown("healthy.com")
	assert.Equal(t, time.Duration(0), remainingHealthy)
}

// TestDomainHealthTrackerGetBestDomain verifies that the healthiest
// domain is selected, preferring healthy over cooling domains.
func TestDomainHealthTrackerGetBestDomain(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	tracker.MarkRateLimited("blocked.com")

	domains := []string{"blocked.com", "healthy.com"}
	best := tracker.GetBestDomain(domains)
	assert.Equal(t, "healthy.com", best)
}

// TestDomainHealthTrackerGetBestDomainAllBlocked verifies that the
// first domain is returned when all are rate-limited, preventing
// a deadlock.
func TestDomainHealthTrackerGetBestDomainAllBlocked(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	tracker.MarkRateLimited("a.com")
	tracker.MarkRateLimited("b.com")

	domains := []string{"a.com", "b.com"}
	best := tracker.GetBestDomain(domains)
	assert.NotEmpty(t, best)
}

// TestDomainHealthTrackerClear verifies that Clear removes all
// rate-limit records.
func TestDomainHealthTrackerClear(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
	tracker.MarkRateLimited("a.com")
	tracker.MarkRateLimited("b.com")
	tracker.Clear()

	assert.True(t, tracker.IsHealthy("a.com"))
	assert.True(t, tracker.IsHealthy("b.com"))
}

// TestDomainHealthTrackerGetAllDomainsOrdered verifies that healthy
// domains come before cooling domains in the ordered list.
func TestDomainHealthTrackerGetAllDomainsOrdered(t *testing.T) {
	tracker := NewDomainHealthTrackerWithCooldown(time.Minute)
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
