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
			"aimeizizi": true,
			"xsnvshen":  true,
			// Video sites whose player configuration and taxonomy are
			// server-rendered and read directly by the provider. Their
			// streams and metadata are fully available over plain HTTP, so
			// escalating to a browser only wastes a slot and a page load.
			"91porn":  true,
			"pornhub": true,
			"xvideos": true,
		},
	}
}

type SelectStrategyInput struct {
	SiteID         string
	TaskType       TaskType
	HTTPRetryCount int
	// HasWaf indicates whether a WAF pre-check detected Cloudflare/CAPTCHA.
	HasWaf bool
}

// Select determines the optimal scrape strategy following a priority chain:
// task type force, JS-heavy site list, WAF detection, retry escalation,
// known static site list, then HTTP-first default.
func (s *StrategySelector) Select(in SelectStrategyInput) ScrapeStrategy {
	if in.TaskType == TaskTypeSniff {
		return StrategyChromedp
	}
	if in.TaskType == TaskTypeVideo {
		// A site known to server-render its player configuration needs no
		// browser, so a WAF hint or a retry must not escalate one: the
		// generic browser path cannot recover the site's own tags and
		// categories anyway, and it costs a page load per attempt.
		if s.StaticSites[in.SiteID] {
			return StrategyHTTP
		}
		if in.HasWaf || in.HTTPRetryCount >= 2 {
			return StrategyChromedp
		}
		return StrategyAuto
	}

	if s.JSSites[in.SiteID] {
		return StrategyChromedp
	}

	if in.HasWaf {
		return StrategyChromedp
	}

	if in.HTTPRetryCount >= 2 {
		return StrategyChromedp
	}

	if s.StaticSites[in.SiteID] {
		return StrategyHTTP
	}

	return StrategyHTTP
}
