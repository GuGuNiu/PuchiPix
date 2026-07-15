-- CreateTable
CREATE TABLE "sniff_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seq" INTEGER,
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

-- CreateIndex
CREATE INDEX "sniff_tasks_status_idx" ON "sniff_tasks"("status");

-- CreateIndex
CREATE INDEX "sniff_tasks_created_at_idx" ON "sniff_tasks"("created_at");
