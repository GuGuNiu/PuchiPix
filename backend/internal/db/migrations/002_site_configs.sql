-- SiteConfig: runtime-overridable site provider configuration
-- Stores variable data (blocked keywords, cookie prefixes, CDN domains,
-- URL patterns, etc.) that supplements the static JSON configuration.
-- When a row exists for a site_id, its values override the JSON defaults.

CREATE TABLE IF NOT EXISTS site_configs (
    site_id               VARCHAR(50) PRIMARY KEY,
    cookie_prefix         VARCHAR(100),
    cdn_domains           JSONB,
    url_patterns          JSONB,
    blocked_keywords      JSONB,
    blocked_categories    JSONB,
    blocked_protagonists  JSONB,
    publisher_prefixes    JSONB,
    age_verify_config     JSONB,
    category_labels       JSONB,
    title_clean_patterns  JSONB,
    title_suffix_patterns JSONB,
    updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_configs_site_id ON site_configs(site_id);
