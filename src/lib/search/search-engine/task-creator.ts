import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { allocateSeq } from '@/lib/core/seq-allocator';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { getDownloadManager, mapTask } from '@/lib/api-helpers';
import type { ScrapeResult } from '@/types';

export interface CreateTaskParams {
  pageUrl: string;
  scrapeResult: ScrapeResult;
  fallbackTitle: string;
  source: 'search' | 'batch';
  onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * 从抓取结果创建下载任务并启动下载
 *
 * 该函数封装了以下重复逻辑：
 * 1. 分配序号 (seq)
 * 2. 创建 prisma.downloadTask 记录（含 videoInfo）
 * 3. 发出 task:created 事件
 * 4. 通过 taskQueueManager 获取下载槽位并启动下载
 *
 * @returns 创建的任务 ID
 */
export async function createDownloadTaskFromScrape(params: CreateTaskParams): Promise<number> {
  const { pageUrl, scrapeResult, fallbackTitle, source, onLog } = params;

  const seq = await allocateSeq();
  const task = await prisma.downloadTask.create({
    data: {
      url: pageUrl,
      m3u8Url: scrapeResult.m3u8_url,
      format: 'mp4',
      status: 'pending',
      seq,
      videoInfo: {
        create: {
          title: scrapeResult.title || fallbackTitle || '',
          sourceUrl: pageUrl,
          tags: JSON.stringify(scrapeResult.tags || []),
          actors: JSON.stringify(scrapeResult.actors || []),
          categories: JSON.stringify(scrapeResult.categories || []),
          director: scrapeResult.director || '',
        },
      },
    },
    include: { videoInfo: true },
  });

  const taskId = task.id;
  const displayTitle = scrapeResult.title || fallbackTitle;
  onLog?.(`✅ 创建下载任务 #${taskId}: ${displayTitle}`);

  eventBus.emit('task:created', {
    taskId,
    title: displayTitle,
    source,
  });

  // 启动下载
  const dm = getDownloadManager();
  const dlTask = mapTask(task);
  taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
    if (!acquired) {
      onLog?.(`下载任务 #${taskId} 已排队等待空闲槽位`, 'warn');
      return;
    }
    const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
    if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
      taskQueueManager.releaseSlot('video', taskId);
      return;
    }
    dm.startDownload(dlTask).catch((err) => {
      onLog?.(`下载任务 #${taskId} 启动失败: ${err.message}`, 'error');
      eventBus.emit('task:failed', { taskId, error: err.message });
    });
  });

  return taskId;
}
