package sites

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

const maxFailCount = 5

// SiteAccountManager manages site login credentials and cookie persistence,
// supporting multi-account rotation and automatic fail tracking.
type SiteAccountManager struct {
	db     *db.Database
	logger *infra.Logger
}

// NewSiteAccountManager creates a manager bound to the given database.
func NewSiteAccountManager(database *db.Database) *SiteAccountManager {
	return &SiteAccountManager{
		db:     database,
		logger: infra.NewLogger("SiteAccountManager"),
	}
}

// GetAvailableAccount returns the least-recently-used active account for a site.
func (m *SiteAccountManager) GetAvailableAccount(ctx context.Context, siteID string) (*db.SiteAccount, error) {
	row := m.db.QueryRow(ctx, `
		SELECT id, site_id, username, password, domain, status, auth_cookies,
		       cookie_prefix, last_login_at, last_used_at, fail_count, remark,
		       created_at, updated_at
		FROM site_accounts
		WHERE site_id = ? AND status = 'active'
		ORDER BY COALESCE(last_used_at, '1970-01-01') ASC,
		         COALESCE(last_login_at, '1970-01-01') ASC,
		         id ASC
		LIMIT 1`, siteID)

	var acc db.SiteAccount
	if err := scanSiteAccount(row, &acc); err != nil {
		return nil, nil
	}
	return &acc, nil
}

// GetAccountById returns a single account by its primary key.
func (m *SiteAccountManager) GetAccountById(ctx context.Context, accountID int) (*db.SiteAccount, error) {
	row := m.db.QueryRow(ctx, `
		SELECT id, site_id, username, password, domain, status, auth_cookies,
		       cookie_prefix, last_login_at, last_used_at, fail_count, remark,
		       created_at, updated_at
		FROM site_accounts WHERE id = ?`, accountID)

	var acc db.SiteAccount
	if err := scanSiteAccount(row, &acc); err != nil {
		return nil, nil
	}
	return &acc, nil
}

// GetAccountsBySiteId returns all accounts for a site as AccountInfo views.
func (m *SiteAccountManager) GetAccountsBySiteId(ctx context.Context, siteID string) ([]AccountInfo, error) {
	rows, err := m.db.Query(ctx, `
		SELECT id, site_id, username, password, domain, status, auth_cookies,
		       cookie_prefix, last_login_at, last_used_at, fail_count, remark,
		       created_at, updated_at
		FROM site_accounts WHERE site_id = ? ORDER BY id ASC`, siteID)
	if err != nil {
		return nil, fmt.Errorf("query accounts: %w", err)
	}
	defer rows.Close()

	var result []AccountInfo
	for rows.Next() {
		var acc db.SiteAccount
		if err := scanSiteAccount(rows, &acc); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		result = append(result, toAccountInfo(&acc))
	}
	return result, nil
}

// GetAccountByDomain returns the least-recently-used active account for a domain.
func (m *SiteAccountManager) GetAccountByDomain(ctx context.Context, domain string) (*db.SiteAccount, error) {
	row := m.db.QueryRow(ctx, `
		SELECT id, site_id, username, password, domain, status, auth_cookies,
		       cookie_prefix, last_login_at, last_used_at, fail_count, remark,
		       created_at, updated_at
		FROM site_accounts
		WHERE domain = ? AND status = 'active'
		ORDER BY COALESCE(last_used_at, '1970-01-01') ASC, id ASC
		LIMIT 1`, domain)

	var acc db.SiteAccount
	if err := scanSiteAccount(row, &acc); err != nil {
		return nil, nil
	}
	return &acc, nil
}

// GetAuthCookies deserializes the stored cookie JSON for an account and
// returns nil if the cookies are missing or all expired.
func (m *SiteAccountManager) GetAuthCookies(ctx context.Context, accountID int) ([]CookieData, error) {
	acc, err := m.GetAccountById(ctx, accountID)
	if err != nil || acc == nil {
		return nil, nil
	}
	if acc.AuthCookies == "" {
		return nil, nil
	}

	var cookies []CookieData
	if err := json.Unmarshal([]byte(acc.AuthCookies), &cookies); err != nil {
		return nil, nil
	}
	if len(cookies) == 0 {
		return nil, nil
	}

	now := time.Now().Unix()
	for _, c := range cookies {
		if c.Expires == 0 || c.Expires > now {
			return cookies, nil
		}
	}
	return nil, nil
}

// SaveAuthCookies persists cookies for an account and resets its fail counter.
func (m *SiteAccountManager) SaveAuthCookies(ctx context.Context, accountID int, cookies []CookieData, cookiePrefix string) error {
	cookiesJSON, err := json.Marshal(cookies)
	if err != nil {
		return fmt.Errorf("marshal cookies: %w", err)
	}

	_, err = m.db.Exec(ctx, `
		UPDATE site_accounts
		SET auth_cookies = ?, cookie_prefix = ?, last_login_at = CURRENT_TIMESTAMP,
		    fail_count = 0, status = 'active', updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		string(cookiesJSON), cookiePrefix, accountID)
	if err != nil {
		return fmt.Errorf("update account cookies: %w", err)
	}

	m.logger.Info("Cookies saved", infra.LogContext{Extra: map[string]any{
		"id":    accountID,
		"count": len(cookies),
	}})
	return nil
}

// MarkUsed updates the last_used_at timestamp for an account.
func (m *SiteAccountManager) MarkUsed(ctx context.Context, accountID int) error {
	_, err := m.db.Exec(ctx, `
		UPDATE site_accounts SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		accountID)
	return err
}

// MarkLoginFailed increments the fail counter and auto-disables the account
// after exceeding the threshold, preventing repeated use of broken credentials.
func (m *SiteAccountManager) MarkLoginFailed(ctx context.Context, accountID int, reason string) error {
	acc, err := m.GetAccountById(ctx, accountID)
	if err != nil || acc == nil {
		return nil
	}

	newFailCount := acc.FailCount + 1
	shouldDisable := newFailCount >= maxFailCount

	status := acc.Status
	remark := acc.Remark
	if shouldDisable {
		status = string(AccountStatusDisabled)
		suffix := ""
		if reason != "" {
			suffix = ": " + reason
		}
		remark = fmt.Sprintf("auto-disabled after %d consecutive login failures%s", newFailCount, suffix)
	}

	_, err = m.db.Exec(ctx, `
		UPDATE site_accounts
		SET fail_count = ?, status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		newFailCount, status, remark, accountID)
	if err != nil {
		return fmt.Errorf("update fail count: %w", err)
	}

	if shouldDisable {
		m.logger.Warn("Account auto-disabled after consecutive failures",
			infra.LogContext{Extra: map[string]any{
				"id":         accountID,
				"failCount": newFailCount,
			}})
	}
	return nil
}

// UpdateStatus changes the status of an account, optionally updating remark.
func (m *SiteAccountManager) UpdateStatus(ctx context.Context, accountID int, status AccountStatus, remark string) error {
	if remark != "" {
		_, err := m.db.Exec(ctx, `
			UPDATE site_accounts SET status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			string(status), remark, accountID)
		return err
	}
	_, err := m.db.Exec(ctx, `
		UPDATE site_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		string(status), accountID)
	return err
}

// CreateAccount inserts a new site account and returns its info view.
func (m *SiteAccountManager) CreateAccount(ctx context.Context, siteID, username, password, domain, cookiePrefix, remark string) (*AccountInfo, error) {
	var id int
	err := m.db.QueryRow(ctx, `
		INSERT INTO site_accounts (site_id, username, password, domain, cookie_prefix, status, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id`,
		siteID, username, password, domain, cookiePrefix, remark).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return &AccountInfo{
		ID:           id,
		SiteID:       siteID,
		Username:     username,
		Domain:       domain,
		Status:       AccountStatusActive,
		CookiePrefix: cookiePrefix,
		Remark:       remark,
		HasCookies:   false,
	}, nil
}

// DeleteAccount removes an account by its primary key.
func (m *SiteAccountManager) DeleteAccount(ctx context.Context, accountID int) error {
	_, err := m.db.Exec(ctx, `DELETE FROM site_accounts WHERE id = ?`, accountID)
	return err
}

func toAccountInfo(acc *db.SiteAccount) AccountInfo {
	return AccountInfo{
		ID:           acc.ID,
		SiteID:       acc.SiteID,
		Username:     acc.Username,
		Domain:       acc.Domain,
		Status:       AccountStatus(acc.Status),
		CookiePrefix: acc.CookiePrefix,
		LastLoginAt:  acc.LastLoginAt,
		LastUsedAt:   acc.LastUsedAt,
		FailCount:    acc.FailCount,
		Remark:       acc.Remark,
		HasCookies:   acc.AuthCookies != "",
	}
}

type scanner interface {
	Scan(dest ...any) error
}

func scanSiteAccount(row scanner, acc *db.SiteAccount) error {
	return row.Scan(
		&acc.ID, &acc.SiteID, &acc.Username, &acc.Password, &acc.Domain,
		&acc.Status, &acc.AuthCookies, &acc.CookiePrefix, &acc.LastLoginAt,
		&acc.LastUsedAt, &acc.FailCount, &acc.Remark, &acc.CreatedAt, &acc.UpdatedAt,
	)
}
