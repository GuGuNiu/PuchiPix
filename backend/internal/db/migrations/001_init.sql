-- PuchiPix PostgreSQL schema — 16 models
-- Tables are created in dependency order to satisfy foreign keys.

-- DownloadTask: video download tasks (m3u8/mp4)
CREATE TABLE IF NOT EXISTS download_tasks (
    id          SERIAL PRIMARY KEY,
    url         TEXT        NOT NULL,
    m3u8_url    TEXT        NOT NULL DEFAULT '',
    status      TEXT        NOT NULL DEFAULT 'pending',
    progress    DOUBLE PRECISION NOT NULL DEFAULT 0,
    file_path   TEXT        NOT NULL DEFAULT '',
    format      TEXT        NOT NULL DEFAULT 'mp4',
    priority    INTEGER     NOT NULL DEFAULT 1,
    error_msg   TEXT        NOT NULL DEFAULT '',
    site_id     TEXT        NOT NULL DEFAULT '',
    seq         TEXT,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- VideoInfo: metadata extracted from download task source
CREATE TABLE IF NOT EXISTS video_infos (
    id          SERIAL PRIMARY KEY,
    task_id     INTEGER     NOT NULL UNIQUE REFERENCES download_tasks(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL DEFAULT '',
    source_url  TEXT        NOT NULL DEFAULT '',
    file_size   BIGINT      NOT NULL DEFAULT 0,
    duration    DOUBLE PRECISION NOT NULL DEFAULT 0,
    tags        TEXT        NOT NULL DEFAULT '',
    actors      TEXT        NOT NULL DEFAULT '',
    categories  TEXT        NOT NULL DEFAULT '',
    director    TEXT        NOT NULL DEFAULT '',
    resolution  TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Gallery: central model for multi-site image/video collections
CREATE TABLE IF NOT EXISTS galleries (
    id                   SERIAL PRIMARY KEY,
    seq                  TEXT,
    source_url           TEXT        NOT NULL UNIQUE,
    site_id              TEXT        NOT NULL DEFAULT 'aimeizizi',
    scraped_domain       TEXT        NOT NULL DEFAULT '',
    title                TEXT        NOT NULL DEFAULT '',
    protagonist          TEXT        NOT NULL DEFAULT '',
    description          TEXT        NOT NULL DEFAULT '',
    category             TEXT        NOT NULL DEFAULT '',
    tags                 TEXT        NOT NULL DEFAULT '',
    cover_url            TEXT        NOT NULL DEFAULT '',
    cover_local_path     TEXT        NOT NULL DEFAULT '',
    image_count          INTEGER     NOT NULL DEFAULT 0,
    video_count          INTEGER     NOT NULL DEFAULT 0,
    page_count           INTEGER     NOT NULL DEFAULT 0,
    status               TEXT        NOT NULL DEFAULT 'pending',
    error_msg            TEXT        NOT NULL DEFAULT '',
    download_method      TEXT        NOT NULL DEFAULT 'pending',
    expected_image_count INTEGER     NOT NULL DEFAULT 0,
    expected_video_count INTEGER     NOT NULL DEFAULT 0,
    content_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
    save_path            TEXT        NOT NULL DEFAULT '',
    total_size           BIGINT      NOT NULL DEFAULT 0,
    downloaded_size      BIGINT      NOT NULL DEFAULT 0,
    game_characters      TEXT,
    publish_time         TEXT,
    scraped_at           TIMESTAMP,
    completed_at         TIMESTAMP,
    created_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_galleries_protagonist ON galleries(protagonist);
CREATE INDEX IF NOT EXISTS idx_galleries_site_protagonist ON galleries(site_id, protagonist);
CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
CREATE INDEX IF NOT EXISTS idx_galleries_category ON galleries(category);
CREATE INDEX IF NOT EXISTS idx_galleries_created_at ON galleries(created_at);

-- GalleryImage: individual image within a gallery
CREATE TABLE IF NOT EXISTS gallery_images (
    id           SERIAL PRIMARY KEY,
    gallery_id   INTEGER     NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    url          TEXT        NOT NULL,
    local_path   TEXT        NOT NULL DEFAULT '',
    file_name    TEXT        NOT NULL DEFAULT '',
    file_size    BIGINT      NOT NULL DEFAULT 0,
    width        INTEGER     NOT NULL DEFAULT 0,
    height       INTEGER     NOT NULL DEFAULT 0,
    format       TEXT        NOT NULL DEFAULT '',
    page_index   INTEGER     NOT NULL DEFAULT 0,
    order_index  INTEGER     NOT NULL DEFAULT 0,
    status       TEXT        NOT NULL DEFAULT 'pending',
    error_msg    TEXT        NOT NULL DEFAULT '',
    completed_at TIMESTAMP,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery_order ON gallery_images(gallery_id, order_index);
CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery_status ON gallery_images(gallery_id, status);

-- GalleryVideo: individual video within a gallery
CREATE TABLE IF NOT EXISTS gallery_videos (
    id           SERIAL PRIMARY KEY,
    gallery_id   INTEGER     NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    url          TEXT        NOT NULL,
    local_path   TEXT        NOT NULL DEFAULT '',
    file_name    TEXT        NOT NULL DEFAULT '',
    file_size    BIGINT      NOT NULL DEFAULT 0,
    duration     DOUBLE PRECISION NOT NULL DEFAULT 0,
    resolution   TEXT        NOT NULL DEFAULT '',
    format       TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'pending',
    error_msg    TEXT        NOT NULL DEFAULT '',
    completed_at TIMESTAMP,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gallery_videos_gallery_status ON gallery_videos(gallery_id, status);

-- GalleryDownloadInfo: archive download metadata (ZIP/RAR)
CREATE TABLE IF NOT EXISTS gallery_download_infos (
    id                 SERIAL PRIMARY KEY,
    gallery_id         INTEGER     NOT NULL UNIQUE REFERENCES galleries(id) ON DELETE CASCADE,
    title              TEXT        NOT NULL DEFAULT '',
    file_count         INTEGER     NOT NULL DEFAULT 0,
    file_size_text     TEXT        NOT NULL DEFAULT '',
    image_dimensions   TEXT        NOT NULL DEFAULT '',
    password           TEXT        NOT NULL DEFAULT '',
    download_url       TEXT        NOT NULL DEFAULT '',
    download_source    TEXT        NOT NULL DEFAULT 'unknown',
    ouo_url            TEXT        NOT NULL DEFAULT '',
    resolved_direct_url TEXT       NOT NULL DEFAULT '',
    provider           TEXT        NOT NULL DEFAULT '',
    requires_login     BOOLEAN     NOT NULL DEFAULT FALSE,
    requires_email     BOOLEAN     NOT NULL DEFAULT FALSE,
    status             TEXT        NOT NULL DEFAULT 'available',
    local_path         TEXT        NOT NULL DEFAULT '',
    extracted_path     TEXT        NOT NULL DEFAULT '',
    actual_size        BIGINT      NOT NULL DEFAULT 0,
    zip_file_name      TEXT        NOT NULL DEFAULT '',
    parallelism        INTEGER     NOT NULL DEFAULT 0,
    avg_speed          INTEGER     NOT NULL DEFAULT 0,
    verified_count     INTEGER     NOT NULL DEFAULT 0,
    count_matched      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SniffTask: URL sniffing operations for gallery discovery
CREATE TABLE IF NOT EXISTS sniff_tasks (
    id            SERIAL PRIMARY KEY,
    seq           TEXT,
    url           TEXT        NOT NULL,
    site_id       TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'pending',
    total_found   INTEGER     NOT NULL DEFAULT 0,
    total_created INTEGER     NOT NULL DEFAULT 0,
    total_skipped INTEGER     NOT NULL DEFAULT 0,
    error_msg     TEXT        NOT NULL DEFAULT '',
    completed_at  TIMESTAMP,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sniff_tasks_status ON sniff_tasks(status);
CREATE INDEX IF NOT EXISTS idx_sniff_tasks_created_at ON sniff_tasks(created_at);

-- AppConfig: key-value application settings
CREATE TABLE IF NOT EXISTS app_configs (
    id          SERIAL PRIMARY KEY,
    key         TEXT        NOT NULL UNIQUE,
    value       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SiteAccount: site credentials and cookie state
CREATE TABLE IF NOT EXISTS site_accounts (
    id            SERIAL PRIMARY KEY,
    site_id       TEXT        NOT NULL,
    username      TEXT        NOT NULL,
    password      TEXT        NOT NULL,
    domain        TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'active',
    auth_cookies  TEXT        NOT NULL DEFAULT '',
    cookie_prefix TEXT        NOT NULL DEFAULT '',
    last_login_at TIMESTAMP,
    last_used_at  TIMESTAMP,
    fail_count    INTEGER     NOT NULL DEFAULT 0,
    remark        TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_accounts_site_status ON site_accounts(site_id, status);
CREATE INDEX IF NOT EXISTS idx_site_accounts_domain ON site_accounts(domain);

-- Person: character database with pinyin matching
CREATE TABLE IF NOT EXISTS persons (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL UNIQUE,
    pinyin        TEXT        NOT NULL DEFAULT '',
    aliases       TEXT        NOT NULL DEFAULT '[]',
    source        TEXT        NOT NULL DEFAULT 'auto',
    source_game   TEXT,
    gallery_count INTEGER     NOT NULL DEFAULT 0,
    confirmed     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_persons_pinyin ON persons(pinyin);
CREATE INDEX IF NOT EXISTS idx_persons_source ON persons(source);

-- BlocklistRule: keyword-based gallery filtering rules
CREATE TABLE IF NOT EXISTS blocklist_rules (
    id         SERIAL PRIMARY KEY,
    site_id    TEXT        NOT NULL DEFAULT 'all',
    field_type TEXT        NOT NULL,
    keyword    TEXT        NOT NULL,
    match_mode TEXT        NOT NULL DEFAULT 'includes',
    enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
    remark     TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blocklist_rules_site_enabled ON blocklist_rules(site_id, enabled);
CREATE INDEX IF NOT EXISTS idx_blocklist_rules_field_type ON blocklist_rules(field_type);

-- UserPreference: per-user settings grouped by category
CREATE TABLE IF NOT EXISTS user_preferences (
    id         SERIAL PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    value      TEXT        NOT NULL DEFAULT '',
    category   TEXT        NOT NULL DEFAULT 'general',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_category ON user_preferences(category);

-- DagEvent: append-only event sourcing for DAG scheduler
CREATE TABLE IF NOT EXISTS dag_events (
    id        SERIAL PRIMARY KEY,
    seq       INTEGER     NOT NULL UNIQUE,
    dag_id    TEXT        NOT NULL,
    node_id   TEXT,
    type      TEXT        NOT NULL,
    payload   TEXT        NOT NULL,
    timestamp TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dag_events_dag_id ON dag_events(dag_id);
CREATE INDEX IF NOT EXISTS idx_dag_events_seq ON dag_events(seq);
CREATE INDEX IF NOT EXISTS idx_dag_events_type ON dag_events(type);

-- DagSnapshot: periodic state checkpoint for DAG instances
CREATE TABLE IF NOT EXISTS dag_snapshots (
    id         SERIAL PRIMARY KEY,
    dag_id     TEXT        NOT NULL,
    state      TEXT        NOT NULL,
    last_seq   INTEGER     NOT NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dag_snapshots_dag_id ON dag_snapshots(dag_id);
CREATE INDEX IF NOT EXISTS idx_dag_snapshots_created_at ON dag_snapshots(created_at);

-- DownloadHistory: completed download records for deduplication
CREATE TABLE IF NOT EXISTS download_history (
    id           TEXT        PRIMARY KEY,
    site_id      TEXT        NOT NULL,
    gallery_id   INTEGER     NOT NULL,
    url          TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'completed',
    image_count  INTEGER     NOT NULL DEFAULT 0,
    video_count  INTEGER     NOT NULL DEFAULT 0,
    title        TEXT        NOT NULL DEFAULT '',
    protagonist  TEXT        NOT NULL DEFAULT '',
    save_path    TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, gallery_id)
);

CREATE INDEX IF NOT EXISTS idx_download_history_site_id ON download_history(site_id);
CREATE INDEX IF NOT EXISTS idx_download_history_created_at ON download_history(created_at);
CREATE INDEX IF NOT EXISTS idx_download_history_status ON download_history(status);

-- SjsBookmark: saved SJS forum thread bookmarks
CREATE TABLE IF NOT EXISTS sjs_bookmarks (
    id            SERIAL PRIMARY KEY,
    url           TEXT        NOT NULL UNIQUE,
    thread_id     TEXT        NOT NULL,
    title         TEXT        NOT NULL DEFAULT '',
    cover_url     TEXT        NOT NULL DEFAULT '',
    author        TEXT        NOT NULL DEFAULT '',
    post_date     TEXT        NOT NULL DEFAULT '',
    forum_section TEXT        NOT NULL DEFAULT '',
    notes         TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sjs_bookmarks_thread_id ON sjs_bookmarks(thread_id);
CREATE INDEX IF NOT EXISTS idx_sjs_bookmarks_created_at ON sjs_bookmarks(created_at);
CREATE INDEX IF NOT EXISTS idx_sjs_bookmarks_forum_section ON sjs_bookmarks(forum_section);
