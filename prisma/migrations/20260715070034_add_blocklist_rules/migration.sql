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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_download_tasks" (
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
INSERT INTO "new_download_tasks" ("created_at", "error_msg", "file_path", "format", "id", "m3u8_url", "priority", "progress", "seq", "status", "updated_at", "url") SELECT "created_at", "error_msg", "file_path", "format", "id", "m3u8_url", "priority", "progress", "seq", "status", "updated_at", "url" FROM "download_tasks";
DROP TABLE "download_tasks";
ALTER TABLE "new_download_tasks" RENAME TO "download_tasks";
CREATE TABLE "new_galleries" (
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
INSERT INTO "new_galleries" ("category", "completed_at", "content_verified", "cover_local_path", "cover_url", "created_at", "description", "download_method", "downloaded_size", "expected_image_count", "expected_video_count", "game_characters", "id", "image_count", "page_count", "protagonist", "publish_time", "save_path", "scraped_at", "scraped_domain", "seq", "site_id", "source_url", "status", "tags", "title", "total_size", "updated_at", "video_count") SELECT "category", "completed_at", "content_verified", "cover_local_path", "cover_url", "created_at", "description", "download_method", "downloaded_size", "expected_image_count", "expected_video_count", "game_characters", "id", "image_count", "page_count", "protagonist", "publish_time", "save_path", "scraped_at", "scraped_domain", "seq", "site_id", "source_url", "status", "tags", "title", "total_size", "updated_at", "video_count" FROM "galleries";
DROP TABLE "galleries";
ALTER TABLE "new_galleries" RENAME TO "galleries";
CREATE UNIQUE INDEX "galleries_source_url_key" ON "galleries"("source_url");
CREATE INDEX "galleries_protagonist_idx" ON "galleries"("protagonist");
CREATE INDEX "galleries_site_id_protagonist_idx" ON "galleries"("site_id", "protagonist");
CREATE INDEX "galleries_status_idx" ON "galleries"("status");
CREATE INDEX "galleries_category_idx" ON "galleries"("category");
CREATE INDEX "galleries_created_at_idx" ON "galleries"("created_at");
CREATE TABLE "new_sniff_tasks" (
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
INSERT INTO "new_sniff_tasks" ("completed_at", "created_at", "error_msg", "id", "seq", "site_id", "status", "total_created", "total_found", "total_skipped", "updated_at", "url") SELECT "completed_at", "created_at", "error_msg", "id", "seq", "site_id", "status", "total_created", "total_found", "total_skipped", "updated_at", "url" FROM "sniff_tasks";
DROP TABLE "sniff_tasks";
ALTER TABLE "new_sniff_tasks" RENAME TO "sniff_tasks";
CREATE INDEX "sniff_tasks_status_idx" ON "sniff_tasks"("status");
CREATE INDEX "sniff_tasks_created_at_idx" ON "sniff_tasks"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
