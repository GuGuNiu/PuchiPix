-- CreateTable
CREATE TABLE "galleries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_url" TEXT NOT NULL,
    "site_id" TEXT NOT NULL DEFAULT 'aimeizizi',
    "title" TEXT NOT NULL DEFAULT '',
    "protagonist" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "cover_url" TEXT NOT NULL DEFAULT '',
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "save_path" TEXT NOT NULL DEFAULT '',
    "total_size" BIGINT NOT NULL DEFAULT 0,
    "downloaded_size" BIGINT NOT NULL DEFAULT 0,
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_video_infos" (
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
INSERT INTO "new_video_infos" ("actors", "created_at", "duration", "file_size", "id", "resolution", "source_url", "tags", "task_id", "title") SELECT "actors", "created_at", "duration", "file_size", "id", "resolution", "source_url", "tags", "task_id", "title" FROM "video_infos";
DROP TABLE "video_infos";
ALTER TABLE "new_video_infos" RENAME TO "video_infos";
CREATE UNIQUE INDEX "video_infos_task_id_key" ON "video_infos"("task_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
