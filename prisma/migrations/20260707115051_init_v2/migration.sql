-- CreateTable
CREATE TABLE "download_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "m3u8_url" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" REAL NOT NULL DEFAULT 0,
    "file_path" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'mp4',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "error_msg" TEXT NOT NULL DEFAULT '',
    "seq" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "video_infos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "task_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT NOT NULL DEFAULT '',
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "duration" REAL NOT NULL DEFAULT 0,
    "tags" TEXT NOT NULL DEFAULT '',
    "actors" TEXT NOT NULL DEFAULT '',
    "categories" TEXT NOT NULL DEFAULT '',
    "director" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "video_infos_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "download_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "galleries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seq" TEXT,
    "source_url" TEXT NOT NULL,
    "site_id" TEXT NOT NULL DEFAULT 'aimeizizi',
    "scraped_domain" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "protagonist" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "cover_url" TEXT NOT NULL DEFAULT '',
    "cover_local_path" TEXT NOT NULL DEFAULT '',
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_msg" TEXT NOT NULL DEFAULT '',
    "download_method" TEXT NOT NULL DEFAULT 'pending',
    "expected_image_count" INTEGER NOT NULL DEFAULT 0,
    "expected_video_count" INTEGER NOT NULL DEFAULT 0,
    "content_verified" BOOLEAN NOT NULL DEFAULT false,
    "save_path" TEXT NOT NULL DEFAULT '',
    "total_size" BIGINT NOT NULL DEFAULT 0,
    "downloaded_size" BIGINT NOT NULL DEFAULT 0,
    "game_characters" TEXT,
    "publish_time" TEXT,
    "scraped_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "gallery_images" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gallery_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "local_path" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL DEFAULT '',
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL DEFAULT '',
    "page_index" INTEGER NOT NULL DEFAULT 0,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_msg" TEXT NOT NULL DEFAULT '',
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gallery_images_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "galleries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gallery_videos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gallery_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "local_path" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL DEFAULT '',
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "duration" REAL NOT NULL DEFAULT 0,
    "resolution" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_msg" TEXT NOT NULL DEFAULT '',
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gallery_videos_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "galleries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gallery_download_infos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gallery_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "file_size_text" TEXT NOT NULL DEFAULT '',
    "image_dimensions" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "download_url" TEXT NOT NULL DEFAULT '',
    "download_source" TEXT NOT NULL DEFAULT 'unknown',
    "ouo_url" TEXT NOT NULL DEFAULT '',
    "resolved_direct_url" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "requires_login" BOOLEAN NOT NULL DEFAULT false,
    "requires_email" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'available',
    "local_path" TEXT NOT NULL DEFAULT '',
    "extracted_path" TEXT NOT NULL DEFAULT '',
    "actual_size" BIGINT NOT NULL DEFAULT 0,
    "zip_file_name" TEXT NOT NULL DEFAULT '',
    "parallelism" INTEGER NOT NULL DEFAULT 0,
    "avg_speed" INTEGER NOT NULL DEFAULT 0,
    "verified_count" INTEGER NOT NULL DEFAULT 0,
    "count_matched" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gallery_download_infos_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "galleries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sniff_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seq" TEXT,
    "url" TEXT NOT NULL,
    "site_id" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_found" INTEGER NOT NULL DEFAULT 0,
    "total_created" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "error_msg" TEXT NOT NULL DEFAULT '',
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "app_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "site_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "site_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "auth_cookies" TEXT NOT NULL DEFAULT '',
    "cookie_prefix" TEXT NOT NULL DEFAULT '',
    "last_login_at" DATETIME,
    "last_used_at" DATETIME,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "persons" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "pinyin" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'auto',
    "source_game" TEXT,
    "gallery_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "blocklist_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "site_id" TEXT NOT NULL DEFAULT 'all',
    "field_type" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "match_mode" TEXT NOT NULL DEFAULT 'includes',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "dag_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seq" INTEGER NOT NULL,
    "dag_id" TEXT NOT NULL,
    "node_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "dag_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dag_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "video_infos_task_id_key" ON "video_infos"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "galleries_source_url_key" ON "galleries"("source_url");

-- CreateIndex
CREATE INDEX "galleries_protagonist_idx" ON "galleries"("protagonist");

-- CreateIndex
CREATE INDEX "galleries_site_id_protagonist_idx" ON "galleries"("site_id", "protagonist");

-- CreateIndex
CREATE INDEX "galleries_status_idx" ON "galleries"("status");

-- CreateIndex
CREATE INDEX "galleries_category_idx" ON "galleries"("category");

-- CreateIndex
CREATE INDEX "galleries_created_at_idx" ON "galleries"("created_at");

-- CreateIndex
CREATE INDEX "gallery_images_gallery_id_order_index_idx" ON "gallery_images"("gallery_id", "order_index");

-- CreateIndex
CREATE INDEX "gallery_images_gallery_id_status_idx" ON "gallery_images"("gallery_id", "status");

-- CreateIndex
CREATE INDEX "gallery_videos_gallery_id_status_idx" ON "gallery_videos"("gallery_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gallery_download_infos_gallery_id_key" ON "gallery_download_infos"("gallery_id");

-- CreateIndex
CREATE INDEX "sniff_tasks_status_idx" ON "sniff_tasks"("status");

-- CreateIndex
CREATE INDEX "sniff_tasks_created_at_idx" ON "sniff_tasks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_configs_key_key" ON "app_configs"("key");

-- CreateIndex
CREATE INDEX "site_accounts_site_id_status_idx" ON "site_accounts"("site_id", "status");

-- CreateIndex
CREATE INDEX "site_accounts_domain_idx" ON "site_accounts"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "persons_name_key" ON "persons"("name");

-- CreateIndex
CREATE INDEX "persons_pinyin_idx" ON "persons"("pinyin");

-- CreateIndex
CREATE INDEX "persons_source_idx" ON "persons"("source");

-- CreateIndex
CREATE INDEX "blocklist_rules_site_id_enabled_idx" ON "blocklist_rules"("site_id", "enabled");

-- CreateIndex
CREATE INDEX "blocklist_rules_field_type_idx" ON "blocklist_rules"("field_type");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_key_key" ON "user_preferences"("key");

-- CreateIndex
CREATE INDEX "user_preferences_category_idx" ON "user_preferences"("category");

-- CreateIndex
CREATE UNIQUE INDEX "dag_events_seq_key" ON "dag_events"("seq");

-- CreateIndex
CREATE INDEX "dag_events_dag_id_idx" ON "dag_events"("dag_id");

-- CreateIndex
CREATE INDEX "dag_events_seq_idx" ON "dag_events"("seq");

-- CreateIndex
CREATE INDEX "dag_events_type_idx" ON "dag_events"("type");

-- CreateIndex
CREATE INDEX "dag_snapshots_dag_id_idx" ON "dag_snapshots"("dag_id");

-- CreateIndex
CREATE INDEX "dag_snapshots_created_at_idx" ON "dag_snapshots"("created_at");
