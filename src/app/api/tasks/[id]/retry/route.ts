import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, ensureM3U8URL, mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import type { DownloadTask } from '@/types';

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

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return NextResponse.json({ error: 'Only failed or cancelled tasks can be retried' }, { status: 400 });
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: 'pending', progress: 0, errorMsg: '' },
    });

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
      progress: 0,
      errorMsg: '',
    });

    taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
      if (!acquired) {
        console.log(`[Retry] 视频 #${taskId} 在排队等待中被取消`);
        return;
      }

      const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
      if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
        taskQueueManager.releaseSlot('video', taskId);
        return;
      }

      dm.startDownload(dlTask).catch((err) => {
        console.error(`Retry download task ${taskId} failed:`, err);
        eventBus.emit('task:failed', { taskId, error: err.message });
      });
    });

    return NextResponse.json({ message: 'Task retried', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to retry task' }, { status: 500 });
  }
}
