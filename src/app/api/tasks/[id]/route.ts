import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { safeDeleteFile, safeDeleteDir, summarizeDeleteResults } from '@/lib/utils/safe-delete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
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

    return NextResponse.json(mapTask(task));
  } catch {
    return NextResponse.json({ error: 'Failed to get task' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const body = await request.json();
    const data: Record<string, string> = {};

    if (body.url !== undefined) data.url = body.url;
    if (body.m3u8_url !== undefined) data.m3u8Url = body.m3u8_url;
    if (body.format !== undefined) data.format = body.format;

    const task = await prisma.downloadTask.update({
      where: { id: taskId },
      data,
      include: { videoInfo: true },
    });

    return NextResponse.json(mapTask(task));
  } catch {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const taskId = parseInt(id, 10);

  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  }

  try {
    // 如果任务正在下载，先取消
    const dm = getDownloadManager();
    if (dm.isDownloading(taskId)) {
      dm.cancelDownload(taskId);
    }

    taskQueueManager.cancelAcquire('video', taskId);

    // 读取任务信息，用于后续本地文件清理
    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      select: { filePath: true },
    });

    if (!task) {
      // 任务不存在，视为已删除
      eventBus.emit('task:deleted', { taskId });
      return NextResponse.json({ success: true });
    }

    const segmentsPath = process.env.SEGMENTS_PATH || './data/segments';
    const resolvedSegmentsPath = path.resolve(segmentsPath);

    const pathsToDelete: string[] = [];

    // 视频文件
    if (task.filePath) {
      pathsToDelete.push(path.resolve(task.filePath));
    }

    // 分片目录
    pathsToDelete.push(path.join(resolvedSegmentsPath, `task_${taskId}`));

    const deleteFailures: string[] = [];

    for (const p of pathsToDelete) {
      // 尝试作为文件删除
      const fileResult = await safeDeleteFile(p);
      if (!fileResult.success) {
        // 如果文件删除失败，尝试作为目录删除
        const dirResult = await safeDeleteDir(p);
        if (!dirResult.success) {
          deleteFailures.push(p);
        }
      }
    }

    if (deleteFailures.length > 0) {
      console.warn(`[TaskDelete] 任务 #${taskId}: 部分文件删除失败 — ${deleteFailures.join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.downloadTask.delete({
        where: { id: taskId },
      });
    });

    // 通知前端 SSE 流
    eventBus.emit('task:deleted', { taskId });

    console.log(`[TaskDelete] 任务 #${taskId} 删除完成 — ${summarizeDeleteResults([
      ...(await Promise.all(pathsToDelete.map(async (p) => {
        return { path: p, success: !deleteFailures.includes(p) };
      }))),
    ])}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete task';
    console.error(`[TaskDelete] 任务 #${taskId} 删除失败:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
