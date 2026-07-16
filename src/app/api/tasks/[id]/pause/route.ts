import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager } from '@/lib/api-helpers';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { eventBus } from '@/lib/core/event-bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const dm = getDownloadManager();

    // 处于识别（scraping）阶段的任务：不在 DownloadManager 的活跃列表中
    // 需要直接更新 DB 状态并释放槽位
    if (task.status === 'scraping') {
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: 'paused' },
      });

      // 释放识别槽位和普通槽位
      taskQueueManager.releaseScrapingSlot('video', taskId);
      taskQueueManager.releaseSlot('video', taskId);

      eventBus.emit('task:progress', {
        taskId,
        progress: 0,
        status: 'paused',
        segment: 0,
        total: 0,
      });

      return NextResponse.json({ message: 'Scraping task paused', task_id: taskId });
    }

    if (!dm.isDownloading(taskId)) {
      return NextResponse.json({ message: 'Task is not downloading, skipped', task_id: taskId, skipped: true });
    }

    dm.pauseDownload(taskId);

    return NextResponse.json({ message: 'Download paused', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to pause download' }, { status: 500 });
  }
}
