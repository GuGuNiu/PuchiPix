package orchestrator

import "testing"

// Video sites that server-render their player configuration must not be
// escalated to a browser: the generic path costs a page load per attempt and
// cannot recover the site's own tags and categories, so an escalation buys
// nothing but latency.
func TestSelectVideoStaticSiteStaysOnHTTP(t *testing.T) {
	selector := NewStrategySelector()

	for _, siteID := range []string{"pornhub", "xvideos", "91porn"} {
		t.Run(siteID, func(t *testing.T) {
			inputs := []SelectStrategyInput{
				{SiteID: siteID, TaskType: TaskTypeVideo},
				{SiteID: siteID, TaskType: TaskTypeVideo, HasWaf: true},
				{SiteID: siteID, TaskType: TaskTypeVideo, HTTPRetryCount: 3},
			}
			for _, in := range inputs {
				if got := selector.Select(in); got != StrategyHTTP {
					t.Errorf("Select(%+v) = %q, want %q", in, got, StrategyHTTP)
				}
			}
		})
	}
}

// 91porn keeps its structured data inside a JSON-LD @graph and publishes
// thumbnailUrl as a bare string on listing entries, so it only qualifies as a
// static site because its provider walks both shapes.
func TestSelectVideo91PornStaysOnHTTP(t *testing.T) {
	selector := NewStrategySelector()
	if got := selector.Select(SelectStrategyInput{SiteID: "91porn", TaskType: TaskTypeVideo}); got != StrategyHTTP {
		t.Errorf("Select(91porn video) = %q, want %q", got, StrategyHTTP)
	}
}

func TestSelectVideoUnknownSiteEscalatesOnWaf(t *testing.T) {
	selector := NewStrategySelector()

	if got := selector.Select(SelectStrategyInput{SiteID: "unknown", TaskType: TaskTypeVideo}); got != StrategyAuto {
		t.Errorf("Select() = %q, want %q for a site with no known strategy", got, StrategyAuto)
	}
	if got := selector.Select(SelectStrategyInput{SiteID: "unknown", TaskType: TaskTypeVideo, HasWaf: true}); got != StrategyChromedp {
		t.Errorf("Select(HasWaf) = %q, want %q", got, StrategyChromedp)
	}
	if got := selector.Select(SelectStrategyInput{SiteID: "unknown", TaskType: TaskTypeVideo, HTTPRetryCount: 2}); got != StrategyChromedp {
		t.Errorf("Select(retry>=2) = %q, want %q", got, StrategyChromedp)
	}
}

// The universal provider has no server-rendered configuration, so it must
// keep using a browser for video tasks.
func TestSelectVideoUniversalUsesBrowser(t *testing.T) {
	selector := NewStrategySelector()
	got := selector.Select(SelectStrategyInput{SiteID: "universal", TaskType: TaskTypeVideo})
	if got == StrategyHTTP {
		t.Errorf("Select(universal video) = %q, want a browser-backed strategy", got)
	}
}

func TestSelectSniffAlwaysUsesBrowser(t *testing.T) {
	selector := NewStrategySelector()
	got := selector.Select(SelectStrategyInput{SiteID: "pornhub", TaskType: TaskTypeSniff})
	if got != StrategyChromedp {
		t.Errorf("Select(sniff) = %q, want %q; listing batch capture needs the page rendered", got, StrategyChromedp)
	}
}
