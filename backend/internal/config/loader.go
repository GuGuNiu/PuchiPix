package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"backend/internal/infra"
)

// Override file names resolved relative to the data directory. Keeping them
// next to the database means a deployment customizes behavior by dropping a
// file into an existing directory rather than learning a new config path.
const (
	siteOverridesFile    = "site-overrides.json"
	subtypeOverridesFile = "subtype-overrides.json"
)

// siteOverrideFile is the shape of site-overrides.json:
// {"sites": {"<siteID>": {"<key>": value}}}.
type siteOverrideFile struct {
	Sites map[string]map[string]any `json:"sites"`
}

// subtypeOverrideFile is the shape of subtype-overrides.json:
// {"sites": {"<siteID>": {"subtypes": {"<subtype>": {"<key>": value}}}}}.
type subtypeOverrideFile struct {
	Sites map[string]struct {
		Subtypes map[string]map[string]any `json:"subtypes"`
	} `json:"sites"`
}

// LoadOverlay reads the override files from dir. Missing files yield empty
// layers instead of errors: overrides are opt-in, and a stock deployment
// must keep working (and keep producing identical lookups) with no override
// files at all. A malformed present file is a hard error — silently ignoring
// user-authored configuration would make typos invisible.
func LoadOverlay(dir string, logger *infra.Logger) (*ConfigOverlay, error) {
	if logger == nil {
		logger = infra.NewLogger("ConfigOverlay")
	}
	overlay := NewConfigOverlay()

	if err := loadSiteOverrides(filepath.Join(dir, siteOverridesFile), overlay, logger); err != nil {
		return nil, err
	}
	if err := loadSubtypeOverrides(filepath.Join(dir, subtypeOverridesFile), overlay, logger); err != nil {
		return nil, err
	}
	return overlay, nil
}

func loadSiteOverrides(path string, overlay *ConfigOverlay, logger *infra.Logger) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}

	var file siteOverrideFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}

	for siteID, settings := range file.Sites {
		l := overlay.SiteLayer(siteID)
		for k, v := range settings {
			l.Settings[k] = v
		}
	}
	logger.Info("Loaded site config overrides", "file", filepath.Base(path), "sites", len(file.Sites))
	return nil
}

func loadSubtypeOverrides(path string, overlay *ConfigOverlay, logger *infra.Logger) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}

	var file subtypeOverrideFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}

	count := 0
	for siteID, entry := range file.Sites {
		for subtype, settings := range entry.Subtypes {
			l := overlay.SubtypeLayer(siteID, subtype)
			for k, v := range settings {
				l.Settings[k] = v
			}
			count++
		}
	}
	logger.Info("Loaded subtype config overrides", "file", filepath.Base(path), "entries", count)
	return nil
}
