package orchestrator

// ScrapeStrategy selects the execution method for a scrape operation.
type ScrapeStrategy string

const (
	// StrategyAuto lets the system decide between HTTP and chromedp.
	StrategyAuto ScrapeStrategy = "auto"
	// StrategyHTTP forces HTTP-only scraping (no browser).
	StrategyHTTP ScrapeStrategy = "http"
	// StrategyChromedp forces browser-based scraping.
	StrategyChromedp ScrapeStrategy = "chromedp"
)

// StrategySelector determines the optimal scrape strategy for a given
// task based on site preferences, historical success rates, WAF
// detection, retry counts, and task type requirements.
type StrategySelector struct {
	// JSSites lists site IDs that require chromedp (JS-heavy, M3U8 sniffing).
	JSSites map[string]bool
	// StaticSites lists site IDs known to work well with HTTP-only.
	StaticSites map[string]bool
}

// NewStrategySelector creates a selector with default site categorizations.
func NewStrategySelector() *StrategySelector {
	return &StrategySelector{
		JSSites: map[string]bool{
			// Universal provider always needs chromedp for M3U8 capture.
			"universal": true,
		},
		StaticSites: map[string]bool{
			// Sites known to serve static HTML content.
			"aimeizizi": true,
			"xsnvshen":  true,
		},
	}
}

// SelectStrategyInput carries the context needed for strategy selection.
type SelectStrategyInput struct {
	SiteID         string
	TaskType       TaskType
	HTTPRetryCount int
	// HasWaf indicates whether a WAF pre-check detected Cloudflare/CAPTCHA.
	HasWaf bool
}

// Select determines the optimal scrape strategy. The decision follows
// a priority chain:
//
//  1. Hard rules — task type forces a specific strategy.
//  2. Site blacklist — JS-heavy sites require chromedp.
//  3. Site whitelist — known static sites prefer HTTP.
//  4. WAF detection — Cloudflare/CAPTCHA requires chromedp.
//  5. Retry escalation — HTTP failures > 2 upgrade to chromedp.
//  6. Default — HTTP-first (safe for most sites).
func (s *StrategySelector) Select(in SelectStrategyInput) ScrapeStrategy {
	// 1. Sniff/M3U8 tasks ALWAYS need chromedp for network interception.
	if in.TaskType == TaskTypeSniff {
		return StrategyChromedp
	}

	// 2. Known JS-heavy sites force chromedp.
	if s.JSSites[in.SiteID] {
		return StrategyChromedp
	}

	// 3. WAF detected — must use browser to bypass.
	if in.HasWaf {
		return StrategyChromedp
	}

	// 4. Retry escalation: after 2+ HTTP failures, upgrade to chromedp.
	if in.HTTPRetryCount >= 2 {
		return StrategyChromedp
	}

	// 5. Known static sites prefer HTTP.
	if s.StaticSites[in.SiteID] {
		return StrategyHTTP
	}

	// 6. Default: HTTP-first (safer, faster, lower resource cost).
	return StrategyHTTP
}
