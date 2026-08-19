package config

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestOverlay() *ConfigOverlay {
	o := NewConfigOverlay()
	o.Global.Settings["blockedTitleKeywords"] = []any{"AI Nudes"}
	o.Global.Settings["downloadConcurrency"] = float64(4)
	o.Global.Settings["scrapingStrategy"] = "auto"
	return o
}

func TestLookupGlobalOnly(t *testing.T) {
	o := newTestOverlay()
	if got := o.LookupString("kanav", "", "scrapingStrategy", "http"); got != "auto" {
		t.Fatalf("global fallback expected 'auto', got %q", got)
	}
}

func TestLookupSiteOverridesGlobal(t *testing.T) {
	o := newTestOverlay()
	l := o.SiteLayer("kanav")
	l.Settings["scrapingStrategy"] = "http"
	if got := o.LookupString("kanav", "", "scrapingStrategy", ""); got != "http" {
		t.Fatalf("site override expected 'http', got %q", got)
	}
	// Other sites must stay on the global value.
	if got := o.LookupString("sjs", "", "scrapingStrategy", ""); got != "auto" {
		t.Fatalf("unrelated site expected global 'auto', got %q", got)
	}
}

func TestLookupSubtypeOverridesSite(t *testing.T) {
	o := newTestOverlay()
	o.SiteLayer("kanav").Settings["scrapingStrategy"] = "http"
	o.SubtypeLayer("kanav", "video").Settings["scrapingStrategy"] = "browser"
	if got := o.LookupString("kanav", "video", "scrapingStrategy", ""); got != "browser" {
		t.Fatalf("subtype override expected 'browser', got %q", got)
	}
	// Site-level value still applies to other subtypes.
	if got := o.LookupString("kanav", "photo", "scrapingStrategy", ""); got != "http" {
		t.Fatalf("other subtype expected site 'http', got %q", got)
	}
}

func TestLookupMissingKey(t *testing.T) {
	o := newTestOverlay()
	if v := o.Lookup("kanav", "video", "nonexistent"); v != nil {
		t.Fatalf("expected nil for missing key, got %v", v)
	}
	if got := o.LookupInt("kanav", "", "nonexistent", 7); got != 7 {
		t.Fatalf("expected fallback 7, got %d", got)
	}
}

func TestAccumulateSlicesAppendsAcrossLayers(t *testing.T) {
	o := newTestOverlay()
	o.SiteLayer("kanav").Settings["blockedTitleKeywords"] = []any{"AI Nudes", "Site Only"}
	o.SubtypeLayer("kanav", "video").Settings["blockedTitleKeywords"] = []any{"Subtype Extra"}

	got := o.AccumulateStrings("kanav", "video", "blockedTitleKeywords")
	want := []string{"AI Nudes", "Site Only", "Subtype Extra"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestAccumulateSlicesDeduplicates(t *testing.T) {
	o := newTestOverlay()
	o.SiteLayer("kanav").Settings["blockedTitleKeywords"] = []any{"AI Nudes", "Extra"}
	got := o.AccumulateStrings("kanav", "", "blockedTitleKeywords")
	if len(got) != 2 {
		t.Fatalf("duplicate entries must be removed, got %v", got)
	}
}

func TestAccumulateScalarDeepestWins(t *testing.T) {
	o := newTestOverlay()
	o.SiteLayer("kanav").Settings["downloadConcurrency"] = float64(8)
	if got := o.LookupInt("kanav", "", "downloadConcurrency", 0); got != 8 {
		t.Fatalf("site scalar expected 8, got %d", got)
	}
	if got := o.LookupInt("sjs", "", "downloadConcurrency", 0); got != 4 {
		t.Fatalf("global scalar expected 4, got %d", got)
	}
}

func TestAccumulateMapsShallowMerge(t *testing.T) {
	o := newTestOverlay()
	o.Global.Settings["urlPatterns"] = map[string]any{"albumId": "/album/(\\d+)"}
	o.SiteLayer("xsnvshen").Settings["urlPatterns"] = map[string]any{"modelId": "/model/(\\d+)"}

	got, ok := o.Accumulate("xsnvshen", "", "urlPatterns").(map[string]any)
	if !ok {
		t.Fatal("expected merged map")
	}
	if got["albumId"] != "/album/(\\d+)" || got["modelId"] != "/model/(\\d+)" {
		t.Fatalf("expected shallow merge preserving both keys, got %v", got)
	}
}

func TestEmptyOverlayBackwardCompatible(t *testing.T) {
	// A fresh overlay with no overrides must behave as "always miss",
	// which is what legacy single-layer deployments resolve to.
	o := NewConfigOverlay()
	if v := o.Lookup("any", "any", "any"); v != nil {
		t.Fatalf("expected nil, got %v", v)
	}
	if s := o.AccumulateStrings("any", "", "any"); s != nil {
		t.Fatalf("expected nil, got %v", s)
	}
}

func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLoadOverlayFiles(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, dir, siteOverridesFile, `{
		"sites": {
			"kanav": {"scrapingStrategy": "http"}
		}
	}`)
	writeTestFile(t, dir, subtypeOverridesFile, `{
		"sites": {
			"kanav": {
				"subtypes": {
					"video": {"scrapingStrategy": "browser"}
				}
			}
		}
	}`)

	o, err := LoadOverlay(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := o.LookupString("kanav", "", "scrapingStrategy", ""); got != "http" {
		t.Fatalf("site override expected 'http', got %q", got)
	}
	if got := o.LookupString("kanav", "video", "scrapingStrategy", ""); got != "browser" {
		t.Fatalf("subtype override expected 'browser', got %q", got)
	}
	if got := o.LookupString("sjs", "", "scrapingStrategy", ""); got != "" {
		t.Fatalf("no override expected for unrelated site, got %q", got)
	}
}

func TestLoadOverlayMissingFiles(t *testing.T) {
	// No override files at all — must succeed with an empty overlay.
	o, err := LoadOverlay(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if v := o.Lookup("kanav", "video", "scrapingStrategy"); v != nil {
		t.Fatalf("expected nil lookup without overrides, got %v", v)
	}
}

func TestLoadOverlayMalformedFileFails(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, dir, siteOverridesFile, `{invalid`)
	if _, err := LoadOverlay(dir, nil); err == nil {
		t.Fatal("malformed override file must fail loudly")
	}
}
