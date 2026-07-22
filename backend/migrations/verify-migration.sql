-- Migration verification queries for SQLite → PostgreSQL data integrity
-- Run after executing the migration script to verify zero data loss.
--
-- Usage:
--   1. Connect to PostgreSQL: psql $DATABASE_URL
--   2. Run this script: \i verify-migration.sql
--   3. Compare the output with SQLite row counts from: sqlite3 ../data/puchipix.db "SELECT 'download_tasks', COUNT(*) FROM download_tasks UNION ALL ..."
--   4. All row counts must match exactly.

-- Table row counts (16 tables)
SELECT 'download_tasks' AS table_name, COUNT(*) AS row_count FROM download_tasks
UNION ALL SELECT 'video_infos', COUNT(*) FROM video_infos
UNION ALL SELECT 'galleries', COUNT(*) FROM galleries
UNION ALL SELECT 'gallery_images', COUNT(*) FROM gallery_images
UNION ALL SELECT 'gallery_videos', COUNT(*) FROM gallery_videos
UNION ALL SELECT 'gallery_download_infos', COUNT(*) FROM gallery_download_infos
UNION ALL SELECT 'sniff_tasks', COUNT(*) FROM sniff_tasks
UNION ALL SELECT 'app_configs', COUNT(*) FROM app_configs
UNION ALL SELECT 'site_accounts', COUNT(*) FROM site_accounts
UNION ALL SELECT 'persons', COUNT(*) FROM persons
UNION ALL SELECT 'blocklist_rules', COUNT(*) FROM blocklist_rules
UNION ALL SELECT 'user_preferences', COUNT(*) FROM user_preferences
UNION ALL SELECT 'dag_events', COUNT(*) FROM dag_events
UNION ALL SELECT 'dag_snapshots', COUNT(*) FROM dag_snapshots
UNION ALL SELECT 'download_history', COUNT(*) FROM download_history
UNION ALL SELECT 'sjs_bookmarks', COUNT(*) FROM sjs_bookmarks
ORDER BY table_name;

-- Index verification (all indexes from 001_init.sql should exist)
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('download_tasks','video_infos','galleries','gallery_images',
    'gallery_videos','gallery_download_infos','sniff_tasks','app_configs',
    'site_accounts','persons','blocklist_rules','user_preferences',
    'dag_events','dag_snapshots','download_history','sjs_bookmarks')
ORDER BY tablename, indexname;

-- Foreign key verification
SELECT conname, conrelid::regclass AS table_name, confrelid::regclass AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN ('download_tasks','video_infos','galleries','gallery_images',
    'gallery_videos','gallery_download_infos','sniff_tasks','app_configs',
    'site_accounts','persons','blocklist_rules','user_preferences',
    'dag_events','dag_snapshots','download_history','sjs_bookmarks')
ORDER BY table_name;

-- Unique constraint verification
SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'u'
  AND conrelid::regclass::text IN ('download_tasks','video_infos','galleries','gallery_images',
    'gallery_videos','gallery_download_infos','sniff_tasks','app_configs',
    'site_accounts','persons','blocklist_rules','user_preferences',
    'dag_events','dag_snapshots','download_history','sjs_bookmarks')
ORDER BY table_name;

-- Sample data spot-check: verify galleries have valid timestamps
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE created_at IS NOT NULL) AS has_created_at,
  COUNT(*) FILTER (WHERE updated_at IS NOT NULL) AS has_updated_at,
  COUNT(*) FILTER (WHERE source_url IS NOT NULL AND source_url != '') AS has_source_url,
  COUNT(*) FILTER (WHERE status IS NOT NULL AND status != '') AS has_status
FROM galleries;

-- Sample data spot-check: verify site_accounts have valid cookies
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE site_id IS NOT NULL AND site_id != '') AS has_site_id,
  COUNT(*) FILTER (WHERE username IS NOT NULL AND username != '') AS has_username,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count,
  COUNT(*) FILTER (WHERE status = 'disabled') AS disabled_count
FROM site_accounts;
