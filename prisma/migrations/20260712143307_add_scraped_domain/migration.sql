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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_galleries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
INSERT INTO "new_galleries" ("category", "completed_at", "cover_url", "created_at", "description", "downloaded_size", "id", "image_count", "page_count", "protagonist", "save_path", "scraped_at", "site_id", "source_url", "status", "tags", "title", "total_size", "updated_at", "video_count") SELECT "category", "completed_at", "cover_url", "created_at", "description", "downloaded_size", "id", "image_count", "page_count", "protagonist", "save_path", "scraped_at", "site_id", "source_url", "status", "tags", "title", "total_size", "updated_at", "video_count" FROM "galleries";
DROP TABLE "galleries";
ALTER TABLE "new_galleries" RENAME TO "galleries";
CREATE UNIQUE INDEX "galleries_source_url_key" ON "galleries"("source_url");
CREATE INDEX "galleries_protagonist_idx" ON "galleries"("protagonist");
CREATE INDEX "galleries_site_id_protagonist_idx" ON "galleries"("site_id", "protagonist");
CREATE INDEX "galleries_status_idx" ON "galleries"("status");
CREATE INDEX "galleries_category_idx" ON "galleries"("category");
CREATE INDEX "galleries_created_at_idx" ON "galleries"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "gallery_download_infos_gallery_id_key" ON "gallery_download_infos"("gallery_id");
