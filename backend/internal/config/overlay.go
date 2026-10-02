package config

import (
	"strconv"
	"strings"
)

type ConfigLayer struct {
	Name     string         `json:"name"`
	Settings map[string]any `json:"settings"`
}

// ConfigOverlay resolves settings across three layers, from least to most
// specific: global defaults, site overrides, and subtype overrides. Lookup
// returns the most specific match; Accumulate merges values across layers.
type ConfigOverlay struct {
	Global   *ConfigLayer
	Sites    map[string]*ConfigLayer
	SubTypes map[string]*ConfigLayer
}

// NewConfigOverlay returns an overlay whose global layer is empty and whose
// override maps are unpopulated, so every lookup misses and callers fall
// through to their own defaults.
func NewConfigOverlay() *ConfigOverlay {
	return &ConfigOverlay{
		Global:   &ConfigLayer{Name: "global", Settings: map[string]any{}},
		Sites:    map[string]*ConfigLayer{},
		SubTypes: map[string]*ConfigLayer{},
	}
}

func subtypeKey(siteID, subtype string) string {
	return siteID + ":" + subtype
}

// layersFor returns the lookup chain ordered from most to least specific.
func (o *ConfigOverlay) layersFor(siteID, subtype string) []*ConfigLayer {
	var chain []*ConfigLayer
	if subtype != "" {
		if l, ok := o.SubTypes[subtypeKey(siteID, subtype)]; ok {
			chain = append(chain, l)
		}
	}
	if l, ok := o.Sites[siteID]; ok {
		chain = append(chain, l)
	}
	if o.Global != nil {
		chain = append(chain, o.Global)
	}
	return chain
}

// Lookup returns the most specific value for key, walking subtype → site →
// global. Returns nil when no layer defines the key.
func (o *ConfigOverlay) Lookup(siteID, subtype, key string) any {
	for _, l := range o.layersFor(siteID, subtype) {
		if v, ok := l.Settings[key]; ok {
			return v
		}
	}
	return nil
}

// LookupString returns the resolved value as a string, or fallback when the
// key is absent from every layer or holds a non-string value.
func (o *ConfigOverlay) LookupString(siteID, subtype, key, fallback string) string {
	if v, ok := o.Lookup(siteID, subtype, key).(string); ok {
		return v
	}
	return fallback
}

// LookupBool returns the resolved value as a bool, or fallback when the key is
// absent from every layer or holds a non-bool value.
func (o *ConfigOverlay) LookupBool(siteID, subtype, key string, fallback bool) bool {
	if v, ok := o.Lookup(siteID, subtype, key).(bool); ok {
		return v
	}
	return fallback
}

// LookupInt returns the resolved value as an int. JSON numbers decode as
// float64, so both int and float64 sources are accepted.
func (o *ConfigOverlay) LookupInt(siteID, subtype, key string, fallback int) int {
	switch v := o.Lookup(siteID, subtype, key).(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return fallback
}

// Accumulate merges values for key across all layers, most-specific last:
// slices are concatenated (global entries first, subtype entries appended)
// with duplicates removed, maps are merged key-by-key with deeper layers
// winning per key, and scalars behave like Lookup (deepest wins). A nil
// return means no layer defines the key.
//
// Blocklists illustrate why concatenation matters: a global list plus a
// site-specific addition should widen the filter, not discard the global
// entries — a plain override would silently weaken filtering for every site
// that customizes the list.
func (o *ConfigOverlay) Accumulate(siteID, subtype, key string) any {
	// layersFor yields most-specific first, so accumulation walks the chain
	// in reverse to keep broader list entries ahead of the more specific
	// additions and let deeper map layers override shallower ones.
	chain := o.layersFor(siteID, subtype)
	var slices [][]any
	var maps []map[string]any
	var scalar any
	for i := len(chain) - 1; i >= 0; i-- {
		v, ok := chain[i].Settings[key]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case []any:
			slices = append(slices, t)
		case map[string]any:
			maps = append(maps, t)
		default:
			scalar = v
		}
	}
	switch {
	case len(slices) > 0:
		return accumulateSlices(slices)
	case len(maps) > 0:
		return accumulateMaps(maps)
	default:
		return scalar
	}
}

// accumulateSlices concatenates in chain order (global first) and drops
// duplicate entries so repeated values across layers do not double-apply.
func accumulateSlices(slices [][]any) []any {
	seen := map[string]bool{}
	var out []any
	for _, s := range slices {
		for _, item := range s {
			k := renderKey(item)
			if seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, item)
		}
	}
	return out
}

// accumulateMaps shallow-merges with later (more specific) layers winning
// per key. Nested values are not merged recursively: a deeper layer that
// customizes one nested field replaces the whole object, keeping merge
// semantics predictable for JSON-shaped settings.
func accumulateMaps(maps []map[string]any) map[string]any {
	out := map[string]any{}
	for _, m := range maps {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// renderKey builds a comparable identity for deduplication across the mixed
// scalar types JSON decoding produces (float64/string/bool).
func renderKey(v any) string {
	switch t := v.(type) {
	case string:
		return "s:" + t
	case float64:
		return "n:" + strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return "b:" + map[bool]string{true: "1", false: "0"}[t]
	default:
		return "o"
	}
}

// AccumulateStrings is the typed helper for list-shaped settings such as
// blockedKeywords; nil when no layer defines the key.
func (o *ConfigOverlay) AccumulateStrings(siteID, subtype, key string) []string {
	v, ok := o.Accumulate(siteID, subtype, key).([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(v))
	for _, item := range v {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// SiteLayer returns the site-level layer, creating it on first use.
func (o *ConfigOverlay) SiteLayer(siteID string) *ConfigLayer {
	if l, ok := o.Sites[siteID]; ok {
		return l
	}
	l := &ConfigLayer{Name: "site:" + siteID, Settings: map[string]any{}}
	o.Sites[siteID] = l
	return l
}

// SubtypeLayer returns the layer keyed by "siteID:subtype", creating it on
// first use.
func (o *ConfigOverlay) SubtypeLayer(siteID, subtype string) *ConfigLayer {
	k := subtypeKey(siteID, subtype)
	if l, ok := o.SubTypes[k]; ok {
		return l
	}
	l := &ConfigLayer{Name: k, Settings: map[string]any{}}
	o.SubTypes[k] = l
	return l
}

// String renders the chain for diagnostics, most specific first.
func (o *ConfigOverlay) String(siteID, subtype string) string {
	var names []string
	for _, l := range o.layersFor(siteID, subtype) {
		names = append(names, l.Name)
	}
	return strings.Join(names, " -> ")
}
