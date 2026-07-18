import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
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

/**
 * 浠庢姄鍙栫粨鏋滃垱寤轰笅杞戒换鍔″苟鍚姩涓嬭浇
 *
 * 灏佽搴忓彿鍒嗛厤銆乸risma 璁板綍鍒涘缓銆佷簨浠跺彂鍑哄拰涓嬭浇妲戒綅鑾峰彇鐨勯噸澶嶉€昏緫銆?
 *
 * @returns 鍒涘缓鐨勪换鍔?ID
 */
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
  onLog?.(`鉁?鍒涘缓涓嬭浇浠诲姟 #${taskId}: ${displayTitle}`);

  eventBus.emit('task:created', {
    taskId,
    title: displayTitle,
    source,
  });

  const dm = getDownloadManager();
  const dlTask = mapTask(task);
  taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
    if (!acquired) {
      onLog?.(`涓嬭浇浠诲姟 #${taskId} 宸叉帓闃熺瓑寰呯┖闂叉Ы浣峘, 'warn');
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
