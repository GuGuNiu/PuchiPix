import type { Server as HTTPServer } from "http";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketIO, getIO, broadcastProgress } from "./src/lib/ws/socket";
import { lifecycle } from "./src/lib/core/lifecycle";
import { eventBus } from "./src/lib/core/event-bus";
import { ttlLock } from "./src/lib/core/ttl-lock";
import type { ProgressMessage } from "@/types";
import { logT } from "@/lib/i18n/server";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server: HTTPServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const pathname = parsedUrl.pathname || "";

    if (pathname.startsWith("/api/ext/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    handle(req, res, parsedUrl);
  });

  lifecycle.onInit({
    name: "task-state-reset",
    timeout: 15000,
    fn: async () => {
      const { resetRunningTasksOnStartup } = await import(
        "./src/lib/core/task-state-reset"
      );
      await resetRunningTasksOnStartup();
      console.log(logT("log.server.taskStateReset"));
    },
  });

  lifecycle.onInit({
    name: "seed-preset-data",
    timeout: 10000,
    fn: async () => {
      const { seedPresetData } = await import(
        "./src/lib/core/seed-preset-data"
      );
      await seedPresetData();
    },
  });

  lifecycle.onInit({
    name: "socket.io",
    fn: async () => {
      initSocketIO(server);
    },
  });

  lifecycle.onInit({
    name: "download-manager",
    timeout: 15000,
    fn: async () => {
      const { getDownloadManager } = await import("./src/lib/api-helpers");
      const dm = getDownloadManager();

      dm.setProgressCallback((msg: ProgressMessage) => {
        broadcastProgress(msg);

        eventBus.emit("task:progress", {
          taskId: msg.task_id,
          progress: msg.progress,
          status: msg.status,
          speed: msg.speed,
          segment: msg.segment,
          total: msg.total,
        });

        if (msg.status === "completed") {
          eventBus.emit("task:completed", { taskId: msg.task_id });
        } else if (msg.status === "failed") {
          eventBus.emit("task:failed", {
            taskId: msg.task_id,
            error: "Download failed",
          });
        }
      });

      console.log(logT("log.server.downloadManagerInit"));
    },
  });

  lifecycle.onInit({
    name: "event-bus-bridge",
    fn: async () => {
      eventBus.setSocketBridge((event, payload) => {
        try {
          getIO().emit(event, payload);
        } catch {}
      });

      console.log(logT("log.server.eventBusBridgeInit"));
    },
  });

  lifecycle.onInit({
    name: "ouo-orchestrator",
    fn: async () => {
      const { getOuoOrchestrator } =
        await import("./src/lib/core/ouo-orchestrator");
      getOuoOrchestrator().start();
      console.log(logT("log.server.ouoOrchestratorStart"));
    },
  });

  lifecycle.onShutdown({
    name: "task-state-reset",
    timeout: 10000,
    fn: async () => {
      const { resetRunningTasksOnStartup } = await import(
        "./src/lib/core/task-state-reset"
      );
      await resetRunningTasksOnStartup();
      console.log("[Server] Task states reset on shutdown");
    },
  });

  lifecycle.onShutdown({
    name: "http-server",
    timeout: 5000,
    fn: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log("[Server] HTTP server closed");
          resolve();
        });
      });
    },
  });

  lifecycle.onShutdown({
    name: "download-manager",
    timeout: 10000,
    fn: async () => {
      const { getDownloadManager } = await import("./src/lib/api-helpers");
      const dm = getDownloadManager();
      await dm.stop();
      console.log("[Server] Download manager stopped");
    },
  });

  lifecycle.onShutdown({
    name: "gallery-downloader",
    timeout: 10000,
    fn: async () => {
      const { getGalleryDownloader } = await import(
        "./src/lib/downloader/gallery-downloader"
      );
      getGalleryDownloader().stopAll();
      console.log("[Server] Gallery downloader stopped");
    },
  });

  lifecycle.onShutdown({
    name: "ouo-orchestrator",
    timeout: 15000,
    fn: async () => {
      const { getOuoOrchestrator } =
        await import("./src/lib/core/ouo-orchestrator");
      await getOuoOrchestrator().stop();
      console.log("[Server] OUO orchestrator stopped");
    },
  });

  lifecycle.onShutdown({
    name: "browser-instances",
    timeout: 10000,
    fn: async () => {
      const { closeSharedBrowser } =
        await import("./src/lib/core/browser-pool");
      const { getSearchEngine } =
        await import("./src/lib/search/search-engine");
      const { getScraper } = await import("./src/lib/scraper/scraper");
      const { getSniffer } = await import("./src/lib/scraper/sniffer");

      await Promise.allSettled([
        closeSharedBrowser(),
        getSearchEngine().close(),
        getScraper().close(),
        getSniffer().stop(),
      ]);

      console.log("[Server] Browser instances closed");
    },
  });

  lifecycle.onShutdown({
    name: "ttl-lock-cleanup",
    fn: async () => {
      ttlLock.stopCleanup();
      ttlLock.clear();
    },
  });

  lifecycle.onShutdown({
    name: "event-bus",
    fn: async () => {
      eventBus.emit("system:shutdown", { reason: "graceful" });
      eventBus.removeSocketBridge();
      eventBus.clear();
    },
  });

  try {
    await lifecycle.boot();

    const port = parseInt(process.env.PORT || "10540", 10);
    server.listen(port, () => {
      console.log(`> PuchiPix server ready on http://localhost:${port}`);

      if (dev) {
        const warmupRoutes = [
          "/api/health",
          "/api/stats",
          "/api/sites",
          "/api/tasks",
          "/",
          "/tasks",
          "/search",
        ];
        Promise.all(
          warmupRoutes.map((route) =>
            fetch(`http://localhost:${port}${route}`).catch(() => {}),
          ),
        ).then(() => {
          console.log("[Server] 路由预热完成");
        });
      }
    });
  } catch (err) {
    console.error("[Server] 启动失败:", err);
    process.exit(1);
  }
});
