import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { logT } from '@/lib/i18n/server';
import { getDownloadManager, mapTask } from '@/lib/api-helpers';
import type { ScrapeResult } from '@/types';

export interface CreateTaskParams {
  pageUrl: string;
  scrapeResult: ScrapeResult;
  fallbackTitle: string;
  source: 'search' | 'batch';
  onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}

export async function createTaskFromScrape(params: CreateTaskParams): Promise<number> {
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
  onLog?.(`? #${taskId}: ${displayTitle}`);

  eventBus.emit('task:created', {
    taskId,
    title: displayTitle,
    source,
  });

  const dm = getDownloadManager();
  const dlTask = mapTask(task);
  taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
    if (!acquired) {
      onLog?.(` #${taskId} , 'warn'`);
      return;
    }
    const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
    if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
      taskQueueManager.releaseSlot('video', taskId);
      return;
    }
      dm.startDownload(dlTask).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        onLog?.(logT('log.taskCreator.downloadStartFailed', { taskId, msg }), 'error');
      eventBus.emit('task:failed', { taskId, error: msg });
    });
  });

  return taskId;
}
