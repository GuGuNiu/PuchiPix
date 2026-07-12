/**
 * tasks/[id]/start/route.ts — 启动下载任务 API
 *
 * POST /api/tasks/:id/start — 启动指定任务的下载
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, ensureM3U8URL, mapTask } from '@/lib/api-helpers';
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

    if (task.status === 'downloading') {
      return NextResponse.json({ error: 'Task is already downloading' }, { status: 400 });
    }

    // 确保 M3U8 URL 存在
    const m3u8URL = await ensureM3U8URL({
      ID: task.id,
      URL: task.url,
      M3U8URL: task.m3u8Url,
    });

    if (!m3u8URL) {
      return NextResponse.json({ error: 'No M3U8 URL found for task' }, { status: 400 });
    }

    const dm = getDownloadManager();

    // 构建下载任务对象（传递给 DownloadManager）
    const dlTask: DownloadTask = mapTask({
      ...task,
      status: 'pending',
      errorMsg: '',
    });

    // 后台启动下载（不等待完成）
    dm.startDownload(dlTask).catch((err) => {
      console.error(`Download task ${taskId} failed:`, err);
    });

    return NextResponse.json({ message: 'Download started', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to start download' }, { status: 500 });
  }
}
