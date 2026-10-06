-- Migration 004: Create gallery_file_progress table
-- Stores checkpoint-based download progress per gallery file so that
-- retries resume from already-downloaded files instead of starting over.
--
-- Two row types share this table:
--   * phase-only rows (file_index = -1 sentinel): the gallery's
--     DownloadPhase state machine value (pending / scanning /
--     in_progress / verifying / complete / failed).
--   * per-file rows (file_index >= 0): one row per gallery_images index
--     with its status (pending / downloading / completed / failed /
--     skipped), local path, size, error, and retry count.
--
-- The composite PRIMARY KEY (gallery_id, file_index) supports both:
-- phase rows upsert on (gallery_id, -1); file rows on (gallery_id,
-- file_index).

CREATE TABLE IF NOT EXISTS gallery_file_progress (
    gallery_id   INTEGER NOT NULL,
    file_index   INTEGER NOT NULL,
    phase        TEXT    NOT NULL DEFAULT '',
    file_type    TEXT    NOT NULL DEFAULT '',
    file_url     TEXT    NOT NULL DEFAULT '',
    local_path   TEXT    NOT NULL DEFAULT '',
    file_size    INTEGER NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT '',
    error_msg    TEXT    NOT NULL DEFAULT '',
    retry_count  INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (gallery_id, file_index)
);

CREATE INDEX IF NOT EXISTS idx_gallery_file_progress_status ON gallery_file_progress(gallery_id, status);
