package data

import _ "embed"

// SiteConfigsJSON holds the embedded unified site configuration,
// serving as the single source of truth for all site-specific data
// at compile time.
//
//go:embed site-configs.json
var SiteConfigsJSON []byte
