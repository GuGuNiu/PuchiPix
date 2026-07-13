/**
 * 模块：PuchiPix 服务入口
 *
 * 使用 LifecycleManager 统一管理启动和关闭流程：
 * 1. boot 阶段：初始化 Socket.IO → 初始化 DownloadManager → 桥接 EventBus
 * 2. ready 阶段：HTTP 服务器开始监听
 * 3. shutdown 阶段：逆序关闭（HTTP → 下载管理器 → 浏览器实例 → TTL 锁 → EventBus）
 *
 * @date 2026-07-09
 * @lastModified 2026-07-11
 */

import { createServer, Server as HTTPServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initSocketIO, getIO, broadcastProgress } from './src/lib/ws/socket';
import { lifecycle } from './src/lib/core/lifecycle';
import { eventBus } from './src/lib/core/event-bus';
import { ttlLock } from './src/lib/core/ttl-lock';
import type { ProgressMessage } from '@/types';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server: HTTPServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const pathname = parsedUrl.pathname || '';

    // 浏览器扩展等外部请求的无效路由，直接返回 404 避免触发 Next.js 编译
    if (pathname.startsWith('/api/ext/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    handle(req, res, parsedUrl);
  });

  // ============================================================
  // 注册 init hooks（按顺序执行）
  // ============================================================

  lifecycle.onInit({
    name: 'socket.io',
    fn: async () => {
      initSocketIO(server);
    },
  });

  lifecycle.onInit({
    name: 'download-manager',
    timeout: 15000,
    fn: async () => {
      // 延迟导入避免阻塞启动
      const { getDownloadManager } = await import('./src/lib/api-helpers');
      const dm = getDownloadManager();

      // 进度回调 → 直接通过 Socket.IO 广播 + EventBus 内部通知
      dm.setProgressCallback((msg: ProgressMessage) => {
        broadcastProgress(msg);

        eventBus.emit('task:progress', {
          taskId: msg.task_id,
          progress: msg.progress,
          status: msg.status,
          speed: msg.speed,
          segment: msg.segment,
          total: msg.total,
        });

        if (msg.status === 'completed') {
          eventBus.emit('task:completed', { taskId: msg.task_id });
        } else if (msg.status === 'failed') {
          eventBus.emit('task:failed', { taskId: msg.task_id, error: 'Download failed' });
        }
      });

      console.log('[Server] Download manager initialized');
    },
  });

  lifecycle.onInit({
    name: 'event-bus-bridge',
    fn: async () => {
      eventBus.setSocketBridge((event, payload) => {
        try {
          getIO().emit(event, payload);
        } catch {
          // Socket.IO 未就绪时忽略
        }
      });

      console.log('[Server] EventBus bridge initialized');
    },
  });

  lifecycle.onInit({
    name: 'ouo-orchestrator',
    fn: async () => {
      const { getOuoOrchestrator } = await import('./src/lib/core/ouo-orchestrator');
      getOuoOrchestrator().start();
      console.log('[Server] OUO orchestrator started');
    },
  });

  // ============================================================
  // 注册 shutdown hooks（逆序执行）
  // ============================================================

  lifecycle.onShutdown({
    name: 'http-server',
    timeout: 5000,
    fn: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log('[Server] HTTP server closed');
          resolve();
        });
      });
    },
  });

  lifecycle.onShutdown({
    name: 'download-manager',
    timeout: 10000,
    fn: async () => {
      const { getDownloadManager } = await import('./src/lib/api-helpers');
      const dm = getDownloadManager();
      dm.stop();
      console.log('[Server] Download manager stopped');
    },
  });

  lifecycle.onShutdown({
    name: 'ouo-orchestrator',
    timeout: 15000,
    fn: async () => {
      const { getOuoOrchestrator } = await import('./src/lib/core/ouo-orchestrator');
      await getOuoOrchestrator().stop();
      console.log('[Server] OUO orchestrator stopped');
    },
  });

  lifecycle.onShutdown({
    name: 'browser-instances',
    timeout: 10000,
    fn: async () => {
      const { closeSharedBrowser } = await import('./src/lib/core/browser-pool');
      const { getSearchEngine } = await import('./src/lib/search/search-engine');
      const { getScraper } = await import('./src/lib/scraper/scraper');
      const { getSniffer } = await import('./src/lib/scraper/sniffer');

      await Promise.allSettled([
        closeSharedBrowser(),
        getSearchEngine().close(),
        getScraper().close(),
        getSniffer().stop(),
      ]);

      console.log('[Server] Browser instances closed');
    },
  });

  lifecycle.onShutdown({
    name: 'ttl-lock-cleanup',
    fn: async () => {
      ttlLock.stopCleanup();
      ttlLock.clear();
    },
  });

  lifecycle.onShutdown({
    name: 'event-bus',
    fn: async () => {
      eventBus.emit('system:shutdown', { reason: 'graceful' });
      eventBus.removeSocketBridge();
      eventBus.clear();
    },
  });

  // ============================================================
  // 启动
  // ============================================================

  try {
    await lifecycle.boot();

    const port = parseInt(process.env.PORT || '10540', 10);
    server.listen(port, () => {
      console.log(`> PuchiPix server ready on http://localhost:${port}`);

      // 路由预热：服务启动后预编译常用路由，避免首次访问时的编译延迟
      if (dev) {
        const warmupRoutes = [
          '/api/health', '/api/stats', '/api/sites',
          '/api/tasks',
          '/', '/tasks', '/search',
        ];
        Promise.all(
          warmupRoutes.map((route) =>
            fetch(`http://localhost:${port}${route}`)
              .catch(() => {})
          )
        ).then(() => {
          console.log('[Server] 路由预热完成');
        });
      }
    });
  } catch (err) {
    console.error('[Server] 启动失败:', err);
    process.exit(1);
  }
});
