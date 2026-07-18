/**
 * M3U8 候选项选择 API
 *
 * POST /api/tasks/:id/select-m3u8
 *
 * 当通用下载器检测到多个 M3U8 地址时，前端弹出选择列表。
 * 用户选择某个 M3U8 后，调用此端点确认选择并启动下载。
 *
 * 请求体：
 *   { "m3u8Url": "https://example.com/stream.m3u8" }
 *
 */

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { mapTask, getDownloadManager } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import { deleteM3U8Candidates } from '@/lib/core/domain/m3u8-candidate-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const body = await request.json();
    const { m3u8Url } = body;

    if (!m3u8Url || typeof m3u8Url !== 'string') {
      return NextResponse.json({ error: 'm3u8Url is required' }, { status: 400 });
    }

    // 验证任务存在
    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { videoInfo: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // 更新任务的 M3U8 URL 和状态
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        m3u8Url,
        status: 'pending',
        errorMsg: '',
      },
    });

    // 清理内存中的候选项
    deleteM3U8Candidates(taskId);

    // 通知前端已选择
    eventBus.emit('task:scraped', { taskId, m3u8URL: m3u8Url, title: task.videoInfo?.title || '' });

    const updatedTask = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { videoInfo: true },
    });

    if (updatedTask) {
      const dm = getDownloadManager();
      const dlTask = mapTask(updatedTask);
      taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
        if (!acquired) {
          console.log(`[SelectM3U8] 视频 #${taskId} 在排队等待中被取消`);
          return;
        }
        const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
        if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
          taskQueueManager.releaseSlot('video', taskId);
          return;
        }
        dm.startDownload(dlTask).catch((err) => {
          console.error(`[Tasks] 下载任务 #${taskId} 启动失败: ${err.message}`);
          eventBus.emit('task:failed', { taskId, error: `下载启动失败: ${err.message}` });
        });
      });
    }

    return NextResponse.json({ success: true, m3u8Url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to select M3U8';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
