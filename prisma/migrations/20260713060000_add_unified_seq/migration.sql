-- Add seq column to download_tasks (unified numbering across videos and galleries)
ALTER TABLE "download_tasks" ADD COLUMN "seq" INTEGER;

-- Add seq column to galleries
ALTER TABLE "galleries" ADD COLUMN "seq" INTEGER;

-- Backfill: assign sequential numbers based on createdAt ordering across both tables
CREATE TEMP TABLE _seq_mapping AS
SELECT id, table_name, ROW_NUMBER() OVER (ORDER BY created_at) as seq_num
FROM (
    SELECT id, 'download_tasks' as table_name, created_at FROM download_tasks WHERE seq IS NULL
    UNION ALL
    SELECT id, 'galleries' as table_name, created_at FROM galleries WHERE seq IS NULL
);

UPDATE download_tasks SET seq = (
    SELECT seq_num FROM _seq_mapping
    WHERE _seq_mapping.id = download_tasks.id AND _seq_mapping.table_name = 'download_tasks'
)
WHERE seq IS NULL;

UPDATE galleries SET seq = (
    SELECT seq_num FROM _seq_mapping
    WHERE _seq_mapping.id = galleries.id AND _seq_mapping.table_name = 'galleries'
)
WHERE seq IS NULL;

DROP TABLE _seq_mapping;

-- Initialize unified sequence counter in AppConfig
INSERT INTO app_configs (key, value, created_at, updated_at)
VALUES (
    'unified_seq_counter',
    CAST((SELECT COUNT(*) FROM download_tasks WHERE seq IS NOT NULL)
       + (SELECT COUNT(*) FROM galleries WHERE seq IS NOT NULL) AS TEXT),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT(key) DO NOTHING;
