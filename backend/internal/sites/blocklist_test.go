package sites

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestMatchValueIncludes verifies that the default "includes" mode
// performs case-insensitive substring matching.
func TestMatchValueIncludes(t *testing.T) {
	assert.True(t, matchValue("Gallery Title", "title", "includes"))
	assert.True(t, matchValue("Gallery TITLE", "title", "includes"))
	assert.True(t, matchValue("gallery title", "TITLE", "includes"))
	assert.False(t, matchValue("Gallery", "missing", "includes"))
}

// TestMatchValueExact verifies that the "exact" mode requires a
// full string match.
func TestMatchValueExact(t *testing.T) {
	assert.True(t, matchValue("spam", "spam", "exact"))
	assert.False(t, matchValue("spam content", "spam", "exact"))
	assert.False(t, matchValue("Spam", "spam", "exact"))
}

// TestMatchValueRegex verifies that the "regex" mode performs
// case-insensitive regex matching.
func TestMatchValueRegex(t *testing.T) {
	assert.True(t, matchValue("Gallery [VIP]", `\[vip\]`, "regex"))
	assert.True(t, matchValue("Gallery VIP", "vip", "regex"))
	assert.False(t, matchValue("Gallery", "vip", "regex"))
}

// TestMatchValueRegexInvalid verifies that an invalid regex pattern
// returns false instead of panicking.
func TestMatchValueRegexInvalid(t *testing.T) {
	assert.False(t, matchValue("test", "[invalid", "regex"))
}

// TestMatchValueDefaultMode verifies that an unrecognized mode falls
// through to "includes" behavior.
func TestMatchValueDefaultMode(t *testing.T) {
	assert.True(t, matchValue("Test Content", "content", "unknown"))
}

// TestBlocklistServiceInvalidateCache verifies that cache invalidation
// clears the cached rules, forcing a re-fetch on next access.
func TestBlocklistServiceInvalidateCache(t *testing.T) {
	svc := NewBlocklistService(nil)
	svc.cache = &cachedRules{
		rules:     []blocklistRule{{SiteID: "test", FieldType: "title", Keyword: "spam", MatchMode: "includes"}},
		fetchedAt: time.Now(),
	}
	svc.InvalidateCache()
	assert.Nil(t, svc.cache)
}
