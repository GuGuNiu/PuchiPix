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

// maxKeywordLength bounds a rule keyword. Combined with Go's RE2 engine
// (linear-time matching, no catastrophic backtracking) this keeps
// user-supplied regexes from becoming a CPU amplification vector.
const maxKeywordLength = 256

// validMatchModes is the closed set of supported match modes.
var validMatchModes = map[string]bool{
	"exact":    true,
	"includes": true,
	"regex":    true,
}

// regexCache caches compiled user regexes so hot content checks do not
// recompile the same pattern on every call (CheckUserRules runs per
// scraped item). A failed compile is cached as nil and logged once per
// distinct pattern — previously an invalid rule silently matched nothing
// forever with no trace (the "silent failure" pattern from the 260823
// code review).
var regexCache sync.Map // map[string]*regexp.Regexp (nil = invalid pattern)

// compileUserRegex returns the cached compiled form of a user-supplied
// regex keyword, or nil when the pattern is invalid.
func compileUserRegex(keyword string) *regexp.Regexp {
	if cached, ok := regexCache.Load(keyword); ok {
		re, _ := cached.(*regexp.Regexp)
		return re
	}
	re, err := regexp.Compile("(?i)" + keyword)
	if err != nil {
		infra.NewLogger("BlocklistService").Warn(
			"Blocklist regex rule failed to compile and will never match",
			map[string]any{"keywordLength": len(keyword), "error": err.Error()})
	}
	regexCache.Store(keyword, re) // re == nil marks the pattern invalid
	return re
}

// ValidateRule checks a rule's fields before persisting so invalid
// match modes / oversized keywords / uncompilable regexes are rejected
// with a 400 at the API boundary instead of silently never matching
// after being saved.
func ValidateRule(keyword, matchMode string) error {
	if keyword == "" {
		return fmt.Errorf("keyword must not be empty")
	}
	if len(keyword) > maxKeywordLength {
		return fmt.Errorf("keyword too long (max %d characters)", maxKeywordLength)
	}
	if !validMatchModes[matchMode] {
		return fmt.Errorf("unsupported match mode %q (allowed: exact, includes, regex)", matchMode)
	}
	if matchMode == "regex" {
		if _, err := regexp.Compile("(?i)" + keyword); err != nil {
			return fmt.Errorf("invalid regex: %w", err)
		}
	}
	return nil
}

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
		re := compileUserRegex(keyword)
		if re == nil {
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
	var ca, ua db.SQLTime
	for rows.Next() {
		var r db.BlocklistRule
		if err := rows.Scan(&r.ID, &r.SiteID, &r.FieldType, &r.Keyword,
			&r.MatchMode, &r.Enabled, &r.Remark, &ca, &ua); err != nil {
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
		VALUES (?, ?, ?, ?, true, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
	_, err := s.db.Exec(ctx, `DELETE FROM blocklist_rules WHERE id = ?`, id)
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
	// Build IN (?,?,...) placeholders — SQLite has no ANY(array) syntax.
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	_, err := s.db.Exec(ctx, `DELETE FROM blocklist_rules WHERE id IN (`+placeholders+`)`, args...)
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
