-- SiteConfig: runtime-overridable site provider configuration
-- Stores variable data (blocked keywords, cookie prefixes, CDN domains,
-- URL patterns, etc.) that supplements the static JSON configuration.
-- When a row exists for a site_id, its values override the JSON defaults.

CREATE TABLE IF NOT EXISTS site_configs (
    site_id               TEXT PRIMARY KEY,
    cookie_prefix         TEXT,
    cdn_domains           TEXT,
    url_patterns          TEXT,
    blocked_keywords      TEXT,
    blocked_categories    TEXT,
    blocked_protagonists  TEXT,
    publisher_prefixes    TEXT,
    age_verify_config     TEXT,
    category_labels       TEXT,
    title_clean_patterns  TEXT,
    title_suffix_patterns TEXT,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_configs_site_id ON site_configs(site_id);
