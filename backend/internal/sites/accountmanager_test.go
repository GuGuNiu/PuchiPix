package sites

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"backend/internal/db"
)

// TestToAccountInfo verifies that the conversion from SiteAccount
// to AccountInfo correctly maps all fields and redacts cookies.
func TestToAccountInfo(t *testing.T) {
	acc := &db.SiteAccount{
		ID:           1,
		SiteID:       "exhentai",
		Username:     "testuser",
		Domain:       "exhentai.org",
		Status:       "active",
		AuthCookies:  `[{"name":"session","value":"abc"}]`,
		CookiePrefix: "ipb_",
		FailCount:    2,
		Remark:       "test account",
	}

	info := toAccountInfo(acc)

	assert.Equal(t, 1, info.ID)
	assert.Equal(t, "exhentai", info.SiteID)
	assert.Equal(t, "testuser", info.Username)
	assert.Equal(t, "exhentai.org", info.Domain)
	assert.Equal(t, AccountStatusActive, info.Status)
	assert.Equal(t, "ipb_", info.CookiePrefix)
	assert.Equal(t, 2, info.FailCount)
	assert.True(t, info.HasCookies, "HasCookies should be true when AuthCookies is non-empty")
}

// TestToAccountInfoNoCookies verifies that HasCookies is false when
// AuthCookies is empty.
func TestToAccountInfoNoCookies(t *testing.T) {
	acc := &db.SiteAccount{
		ID:          2,
		AuthCookies: "",
	}

	info := toAccountInfo(acc)
	assert.False(t, info.HasCookies)
}

// TestToAccountInfoStatusConversion verifies that all status strings
// are correctly converted to AccountStatus type.
func TestToAccountInfoStatusConversion(t *testing.T) {
	tests := []struct {
		status   string
		expected AccountStatus
	}{
		{"active", AccountStatusActive},
		{"disabled", AccountStatusDisabled},
		{"cooldown", AccountStatusCooldown},
		{"expired", AccountStatusExpired},
		{"banned", AccountStatusBanned},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			acc := &db.SiteAccount{Status: tt.status}
			info := toAccountInfo(acc)
			assert.Equal(t, tt.expected, info.Status)
		})
	}
}

// TestMaxFailCount verifies that the fail threshold is 5, ensuring
// accounts are disabled after exactly 5 consecutive failures.
func TestMaxFailCount(t *testing.T) {
	assert.Equal(t, 5, maxFailCount)
}

// TestNewSiteAccountManager verifies that a new manager can be
// created without errors, even with a nil database.
func TestNewSiteAccountManager(t *testing.T) {
	mgr := NewSiteAccountManager(nil)
	assert.NotNil(t, mgr)
}
