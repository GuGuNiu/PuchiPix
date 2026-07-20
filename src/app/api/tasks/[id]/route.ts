import type { NextRequest} from 'next/server';
import { loggers } from '@/lib/core/infra/logger';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { safeDeleteFile, safeDeleteDir, summarizeDeleteResults } from '@/lib/utils/safe-delete';
import { logT } from '@/lib/i18n/server';

const logger = loggers.tasksAPI();
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseTaskId(id: string): number | null {
  const taskId = parseInt(id, 10);
  return isNaN(taskId) ? null : taskId;
}

type TaskWithVideo = Prisma.DownloadTaskGetPayload<{ include: { videoInfo: true } }>;

async function getTask(taskId: number): Promise<TaskWithVideo | null> {
  return prisma.downloadTask.findUnique({
    where: { id: taskId },
    include: { videoInfo: true },
  });
}


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseTaskId(id);

    if (taskId === null) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const task = await getTask(taskId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const { mapTask } = await import('@/lib/api-helpers');
    return NextResponse.json(mapTask(task));
  } catch {
    return NextResponse.json({ error: 'Failed to get task' }, { status: 500 });
  }
}

// PUT /api/tasks/: id — Update task

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseTaskId(id);

    if (taskId === null) {
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

    const { mapTask } = await import('@/lib/api-helpers');
    return NextResponse.json(mapTask(task));
  } catch {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// POST /api/tasks/:id — cancel / pause / resume / retry / select-m3u8 / start

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseTaskId(id);

    if (taskId === null) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, ...rest } = body;

    switch (action) {
      case 'cancel': {
        const task = await prisma.downloadTask.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        workerManager.send({
          type: 'task:action',
          payload: { taskId, action: 'cancel' },
        });

        return NextResponse.json({ message: 'Download cancelled', task_id: taskId });
      }

      case 'pause': {
        const task = await prisma.downloadTask.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        if (task.status === 'scraping') {
          await prisma.downloadTask.update({
            where: { id: taskId },
            data: { status: 'paused' },
          });

          workerManager.send({
            type: 'task:action',
            payload: { taskId, action: 'pause' },
          });

          eventBus.emit('task:progress', {
            taskId,
            progress: 0,
            status: 'paused',
            segment: 0,
            total: 0,
          });

          return NextResponse.json({ message: 'Scraping task paused', task_id: taskId });
        }

        workerManager.send({
          type: 'task:action',
          payload: { taskId, action: 'pause' },
        });
        return NextResponse.json({ message: 'Download paused', task_id: taskId });
      }

      case 'resume': {
        const task = await prisma.downloadTask.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        if (task.status !== 'paused') {
          return NextResponse.json({ error: 'Task is not paused' }, { status: 400 });
        }

        workerManager.send({
          type: 'task:action',
          payload: { taskId, action: 'resume' },
        });

        return NextResponse.json({ message: 'Download resumed', task_id: taskId });
      }

      case 'retry': {
        const task = await getTask(taskId);

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

        workerManager.send({
          type: 'task:action',
          payload: { taskId, action: 'retry' },
        });

        return NextResponse.json({ message: 'Task retried', task_id: taskId });
      }

      case 'select-m3u8': {
        const { m3u8Url } = rest;

        if (!m3u8Url || typeof m3u8Url !== 'string') {
          return NextResponse.json({ error: 'm3u8Url is required' }, { status: 400 });
        }

        const task = await getTask(taskId);

        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        await prisma.downloadTask.update({
          where: { id: taskId },
          data: {
            m3u8Url,
            status: 'pending',
            errorMsg: '',
          },
        });

        eventBus.emit('task:scraped', { taskId, m3u8URL: m3u8Url, title: task.videoInfo?.title || '' });

        workerManager.send({
          type: 'task:select-m3u8',
          payload: { taskId, m3u8Url },
        });

        return NextResponse.json({ success: true, m3u8Url });
      }

      case 'start': {
        const task = await getTask(taskId);

        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        if (task.status === 'downloading') {
          return NextResponse.json({ error: 'Task is already downloading' }, { status: 400 });
        }

        workerManager.send({
          type: 'task:action',
          payload: { taskId, action: 'start' },
        });

        return NextResponse.json({ message: 'Download started', task_id: taskId });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tasks/: id — Delete task

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const taskId = parseTaskId(id);

  if (taskId === null) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
  }

  try {
    workerManager.send({
      type: 'task:action',
      payload: { taskId, action: 'cancel' },
    });

    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      select: { filePath: true },
    });

    if (!task) {
      eventBus.emit('task:deleted', { taskId });
      return NextResponse.json({ success: true });
    }

    const segmentsPath = process.env.SEGMENTS_PATH || './data/segments';
    const resolvedSegmentsPath = path.resolve(segmentsPath);

    const pathsToDelete: string[] = [];

    if (task.filePath) {
      pathsToDelete.push(path.resolve(task.filePath));
    }

    pathsToDelete.push(path.join(resolvedSegmentsPath, `task_${taskId}`));

    const deleteFailures: string[] = [];

    for (const p of pathsToDelete) {
      const fileResult = await safeDeleteFile(p);
      if (!fileResult.success) {
        const dirResult = await safeDeleteDir(p);
        if (!dirResult.success) {
          deleteFailures.push(p);
        }
      }
    }

    if (deleteFailures.length > 0) {
      console.warn(`[TaskDelete] Task #${taskId}: partial file deletion failed — ${deleteFailures.join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.downloadTask.delete({
        where: { id: taskId },
      });
    });

    eventBus.emit('task:deleted', { taskId });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
