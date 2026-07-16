import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, ensureM3U8URL, mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import type { DownloadTask } from '@/types';
import { logT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
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
      include: { videoInfo: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status === 'downloading') {
      return NextResponse.json({ error: 'Task is already downloading' }, { status: 400 });
    }

    const m3u8URL = await ensureM3U8URL({
      ID: task.id,
      URL: task.url,
      M3U8URL: task.m3u8Url,
    });

    if (!m3u8URL) {
      return NextResponse.json({ error: 'No M3U8 URL found for task' }, { status: 400 });
    }

    const dm = getDownloadManager();

    const dlTask: DownloadTask = mapTask({
      ...task,
      status: 'pending',
      errorMsg: '',
    });

    taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
      if (!acquired) {
        console.log(logT('log.galleryHandler.cancelledInQueue', { id: taskId }));
        return;
      }

      const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
      if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
        taskQueueManager.releaseSlot('video', taskId);
        return;
      }

      dm.startDownload(dlTask).catch((err) => {
        console.error(`Download task ${taskId} failed:`, err);
        eventBus.emit('task:failed', { taskId, error: err.message });
      });
    });

    return NextResponse.json({ message: 'Download started', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to start download' }, { status: 500 });
  }
}
