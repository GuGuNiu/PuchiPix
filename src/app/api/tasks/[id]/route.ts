/**
 * tasks/[id]/route.ts — 单个任务的 CRUD API
 *
 * GET    /api/tasks/:id  — 获取单个任务详情
 * PUT    /api/tasks/:id  — 更新任务（URL、格式等）
 * DELETE /api/tasks/:id  — 删除任务（同时取消正在进行的下载）
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/tasks/:id — 获取任务详情
// ============================================================
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

// ============================================================
// PUT /api/tasks/:id — 更新任务
// ============================================================
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

// ============================================================
// DELETE /api/tasks/:id — 删除任务
// ============================================================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // 如果任务正在下载，先取消
    const dm = getDownloadManager();
    if (dm.isDownloading(taskId)) {
      dm.cancelDownload(taskId);
    }

    await prisma.downloadTask.delete({
      where: { id: taskId },
    });

    eventBus.emit('task:deleted', { taskId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
