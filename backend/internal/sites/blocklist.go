package sites

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"backend/internal/db"
	"backend/internal/infra"
)

const blocklistCacheTTL = 60 * time.Second

// blocklistRule mirrors a subset of the BlocklistRule model for in-memory
// matching, avoiding full-row scans on every content check.
type blocklistRule struct {
	SiteID    string
	FieldType string
	Keyword   string
	MatchMode string
}

// cachedRules holds the fetched rule set with its retrieval timestamp.
type cachedRules struct {
	rules    []blocklistRule
	fetchedAt time.Time
}

// BlocklistService provides keyword-based content filtering with a 60-second
// cache, supporting title, category, protagonist, and director fields.
type BlocklistService struct {
	db     *db.Database
	logger *infra.Logger

	mu    sync.Mutex
	cache *cachedRules
}

// NewBlocklistService creates a service bound to the given database.
func NewBlocklistService(database *db.Database) *BlocklistService {
	return &BlocklistService{
		db:     database,
		logger: infra.NewLogger("BlocklistService"),
	}
}

// GetRules returns the cached rule set, refreshing from the database when
// the cache expires. Concurrent callers share a single fetch.
func (s *BlocklistService) GetRules(ctx context.Context) ([]blocklistRule, error) {
	s.mu.Lock()
	if s.cache != nil && time.Since(s.cache.fetchedAt) < blocklistCacheTTL {
		rules := s.cache.rules
		s.mu.Unlock()
		return rules, nil
	}
	s.mu.Unlock()

	return s.fetchRules(ctx)
}

func (s *BlocklistService) fetchRules(ctx context.Context) ([]blocklistRule, error) {
	rows, err := s.db.Query(ctx, `
		SELECT site_id, field_type, keyword, match_mode
		FROM blocklist_rules WHERE enabled = true`)
	if err != nil {
		return nil, fmt.Errorf("query blocklist rules: %w", err)
	}
	defer rows.Close()

	var rules []blocklistRule
	for rows.Next() {
		var r blocklistRule
		if err := rows.Scan(&r.SiteID, &r.FieldType, &r.Keyword, &r.MatchMode); err != nil {
			return nil, fmt.Errorf("scan rule: %w", err)
		}
		rules = append(rules, r)
	}

	s.mu.Lock()
	s.cache = &cachedRules{rules: rules, fetchedAt: time.Now()}
	s.mu.Unlock()

	return rules, nil
}

// InvalidateCache clears the cached rule set so the next GetRules call
// re-fetches from the database.
func (s *BlocklistService) InvalidateCache() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache = nil
}

// CheckUserRules evaluates all applicable blocklist rules against the given
// content fields, returning the first match as a BlockCheckResult.
func (s *BlocklistService) CheckUserRules(ctx context.Context, siteID string, fields map[string]string) (BlockCheckResult, error) {
	rules, err := s.GetRules(ctx)
	if err != nil {
		return BlockCheckResult{}, err
	}
	if len(rules) == 0 {
		return BlockCheckResult{Blocked: false}, nil
	}

	for _, rule := range rules {
		if rule.SiteID != "all" && rule.SiteID != siteID {
			continue
		}

		value, ok := fields[rule.FieldType]
		if !ok || value == "" {
			continue
		}

		if matchValue(value, rule.Keyword, rule.MatchMode) {
			return BlockCheckResult{
				Blocked: true,
				Reason:  fmt.Sprintf("%s matches blocklist rule: %q", rule.FieldType, rule.Keyword),
			}, nil
		}
	}

	return BlockCheckResult{Blocked: false}, nil
}

func matchValue(value, keyword, mode string) bool {
	switch mode {
	case "exact":
		return value == keyword
	case "regex":
		re, err := regexp.Compile("(?i)" + keyword)
		if err != nil {
			return false
		}
		return re.MatchString(value)
	case "includes":
		fallthrough
	default:
		return strings.Contains(strings.ToLower(value), strings.ToLower(keyword))
	}
}

// GetAll returns all blocklist rules for administrative views.
func (s *BlocklistService) GetAll(ctx context.Context) ([]db.BlocklistRule, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, site_id, field_type, keyword, match_mode, enabled, remark, created_at, updated_at
		FROM blocklist_rules
		ORDER BY site_id ASC, field_type ASC, created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("query all rules: %w", err)
	}
	defer rows.Close()

	var result []db.BlocklistRule
	for rows.Next() {
		var r db.BlocklistRule
		if err := rows.Scan(&r.ID, &r.SiteID, &r.FieldType, &r.Keyword,
			&r.MatchMode, &r.Enabled, &r.Remark, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan rule: %w", err)
		}
		result = append(result, r)
	}
	return result, nil
}

// Create inserts a new blocklist rule and invalidates the cache.
func (s *BlocklistService) Create(ctx context.Context, siteID, fieldType, keyword, matchMode, remark string) error {
	if matchMode == "" {
		matchMode = "includes"
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO blocklist_rules (site_id, field_type, keyword, match_mode, enabled, remark, created_at, updated_at)
		VALUES ($1, $2, $3, $4, true, $5, NOW(), NOW())`,
		siteID, fieldType, keyword, matchMode, remark)
	if err != nil {
		return fmt.Errorf("create rule: %w", err)
	}
	s.InvalidateCache()
	return nil
}

// Update modifies an existing blocklist rule and invalidates the cache.
func (s *BlocklistService) Update(ctx context.Context, id int, fields map[string]any) error {
	setParts := []string{}
	args := []any{}
	argIdx := 1

	if v, ok := fields["enabled"]; ok {
		setParts = append(setParts, fmt.Sprintf("enabled = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := fields["siteId"]; ok {
		setParts = append(setParts, fmt.Sprintf("site_id = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := fields["fieldType"]; ok {
		setParts = append(setParts, fmt.Sprintf("field_type = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := fields["keyword"]; ok {
		setParts = append(setParts, fmt.Sprintf("keyword = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := fields["matchMode"]; ok {
		setParts = append(setParts, fmt.Sprintf("match_mode = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := fields["remark"]; ok {
		setParts = append(setParts, fmt.Sprintf("remark = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}

	if len(setParts) == 0 {
		return nil
	}

	setParts = append(setParts, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, time.Now())
	argIdx++

	args = append(args, id)
	query := fmt.Sprintf("UPDATE blocklist_rules SET %s WHERE id = $%d",
		strings.Join(setParts, ", "), argIdx)

	_, err := s.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update rule: %w", err)
	}
	s.InvalidateCache()
	return nil
}

// Delete removes a single blocklist rule by ID.
func (s *BlocklistService) Delete(ctx context.Context, id int) error {
	_, err := s.db.Exec(ctx, `DELETE FROM blocklist_rules WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	s.InvalidateCache()
	return nil
}

// BatchDelete removes multiple blocklist rules by IDs.
func (s *BlocklistService) BatchDelete(ctx context.Context, ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.db.Exec(ctx, `DELETE FROM blocklist_rules WHERE id = ANY($1)`, ids)
	if err != nil {
		return fmt.Errorf("batch delete rules: %w", err)
	}
	s.InvalidateCache()
	return nil
}

// CheckBlockedDefault performs site-agnostic content blocking checks
// against keyword lists for titles, categories, and protagonists.
// It is used by site providers to avoid duplicating iteration logic.
func CheckBlockedDefault(
	title, category, protagonist string,
	blockedKeywords, blockedCategories, blockedProtagonists []string,
	protagonistsEnabled bool,
) BlockCheckResult {
	if title != "" {
		titleLower := strings.ToLower(title)
		for _, keyword := range blockedKeywords {
			if strings.Contains(titleLower, strings.ToLower(keyword)) {
				return BlockCheckResult{Blocked: true, Reason: "title contains \"" + keyword + "\""}
			}
		}
	}
	if category != "" {
		for _, keyword := range blockedCategories {
			if strings.Contains(category, keyword) {
				return BlockCheckResult{Blocked: true, Reason: "category contains \"" + keyword + "\""}
			}
		}
	}
	if protagonistsEnabled && protagonist != "" {
		for _, blocked := range blockedProtagonists {
			if protagonist == blocked || strings.Contains(protagonist, blocked) {
				return BlockCheckResult{Blocked: true, Reason: "protagonist matches \"" + blocked + "\""}
			}
		}
	}
	return BlockCheckResult{Blocked: false}
}
