import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager } from '@/lib/api-helpers';
import { taskQueueManager } from '@/lib/core/task-queue-manager';

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
    dm.cancelDownload(taskId);

    // 取消排队中的普通槽位和识别槽位请求
    taskQueueManager.cancelAcquire('video', taskId);
    taskQueueManager.cancelScrapingAcquire('video', taskId);

    // 释放已持有的识别槽位（如果任务处于 scraping 阶段）
    taskQueueManager.releaseScrapingSlot('video', taskId);

    // cancelDownload 已 emit task:cancelled 事件，会触发 releaseSlot('video', taskId)
    // 但如果任务不在 activeDownloads 中（如 scraping 阶段），需要手动释放普通槽位
    if (task.status === 'scraping' || task.status === 'pending') {
      taskQueueManager.releaseSlot('video', taskId);
    }

    return NextResponse.json({ message: 'Download cancelled', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel download' }, { status: 500 });
  }
}
