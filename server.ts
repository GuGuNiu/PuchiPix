try {
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: NodeJS.Module | undefined, ...args: unknown[]) {
    if (request === 'server-only') {
      return require.resolve('./empty-server-only.js');
    }
    return origResolve.call(this, request, parent, ...args);
  };
} catch { }

import type { Server as HTTPServer } from "http";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { lifecycle } from "./src/lib/core/infra/lifecycle";
import { eventBus } from "./src/lib/core/infra/event-bus";
import { createLogger } from "./src/lib/core/infra/logger";

const serverLogger = createLogger('Server');

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
    name: "socket.io",
    fn: async () => {
      const { initSocketIO } = await import("./src/lib/ws/socket");
      initSocketIO(server);
    },
  });

  // 桥接非 DAG 事件到 Socket.IO（DAG 事件由 ws/socket.ts 内的 setupDagEventBridge 定向推送）
  lifecycle.onInit({
    name: "event-bus-bridge",
    fn: async () => {
      const { getIO } = await import("./src/lib/ws/socket");
      const { logT } = await import("@/lib/i18n/server");
      eventBus.setSocketBridge((event, payload) => {
        if (typeof event === 'string' && event.startsWith('dag:')) return;
        if (typeof event === 'string' && event.startsWith('worker:')) return;
        try {
          getIO().emit(event, payload);
        } catch { }
      });

      serverLogger.info(logT("log.server.eventBusBridgeInit"));
    },
  });

  // Worker 进程管理 — fork 子进程运行全部重负载模块
  lifecycle.onInit({
    name: "worker",
    timeout: 60000,
    fn: async () => {
      const { workerManager } = await import("./src/lib/core/infra/worker-manager");
      workerManager.start();
      await workerManager.waitForReady(30000);
      serverLogger.info("Worker process ready");
    },
  });

  // IPC → EventBus 桥接 — Worker 事件转发到主进程 EventBus
  lifecycle.onInit({
    name: "ipc-event-bridge",
    fn: async () => {
      const { workerManager } = await import("./src/lib/core/infra/worker-manager");
      const { setupMainIpcBridge } = await import("./src/lib/core/infra/ipc-bridge");
      setupMainIpcBridge();

      // Worker task:progress events forwarded to Socket.IO clients as 'progress'
      // The Worker emits 'task:progress' via IPC; broadcastProgress re-emits as
      // 'progress' to match the frontend socket-store listener (socket.on('progress'))
      workerManager.on('event', (event: string, payload: unknown) => {
        if (event === 'task:progress' && payload) {
          const { broadcastProgress } = require("./src/lib/ws/socket");
          try {
            broadcastProgress(payload);
          } catch { }
        }
      });
    },
  });

  // DAG 快照缓存 — 监听 Worker 推送的 dag:snapshotSync 事件，更新主进程缓存
  lifecycle.onInit({
    name: "dag-snapshot-cache",
    fn: async () => {
      const { dagSnapshotCache } = await import("./src/lib/core/orchestrator/dag/snapshot-cache");

      eventBus.on('dag:snapshotSync', (payload) => {
        dagSnapshotCache.update(payload);
      });

      // Worker 重启时清除缓存，避免向 API 返回陈旧数据
      eventBus.on('worker:restarting', () => {
        dagSnapshotCache.clear();
      });

      serverLogger.info("DAG snapshot cache listener initialized");
    },
  });

  // 关闭顺序：Worker 先停 → event-bus → HTTP 最后
  // shutdown hooks 按注册逆序执行，因此 http-server 先注册（最后执行），worker 最后注册（最先执行）
  lifecycle.onShutdown({
    name: "http-server",
    timeout: 5000,
    fn: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          serverLogger.info("HTTP server closed");
          resolve();
        });
      });
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

  lifecycle.onShutdown({
    name: "worker",
    timeout: 20000,
    fn: async () => {
      const { workerManager } = await import("./src/lib/core/infra/worker-manager");
      await workerManager.stop();
      serverLogger.info("Worker process stopped");
    },
  });

  process.on('beforeExit', async () => {
    try {
      const { workerManager } = await import("./src/lib/core/infra/worker-manager");
      await workerManager.stop();
    } catch { }
  });

  try {
    await lifecycle.boot();

    const port = parseInt(process.env.PORT || "10540", 10);
    server.listen(port, () => {
      serverLogger.info(`PuchiPix server ready on http://localhost:${port}`);

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
            fetch(`http://localhost:${port}${route}`).catch(() => { }),
          ),
        ).then(() => {
          serverLogger.info("Route warmup completed");
        });
      }
    });
  } catch (err) {
    serverLogger.error("Startup failed", { error: err });
    process.exit(1);
  }
});
