import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * 获取最新系统日志
 *
 * 查询最近一条任务状态变更或系统事件日志，
 * 用于翻页栏控制台实时显示。
 */
export async function GET(): Promise<NextResponse> {
  try {
    // 查询最近更新的任务，提取其状态作为日志来源
    const latestTask = await prisma.downloadTask.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        seq: true,
        status: true,
        videoInfo: {
          select: {
            title: true,
          },
        },
        updatedAt: true,
      },
    });

    if (!latestTask) {
      return NextResponse.json({ log: '系统就绪，等待任务...' });
    }

    // 格式化日志消息
    const id = latestTask.seq ?? String(latestTask.id);
    const title = latestTask.videoInfo?.title ?? `任务 #${id}`;
    const status = latestTask.status;
    const time = new Date(latestTask.updatedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const statusMap: Record<string, string> = {
      pending: '等待中',
      scraping: '识别中',
      downloading: '下载中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };

    const log = `[${time}] ${title.slice(0, 20)}${title.length > 20 ? '...' : ''} - ${statusMap[status] ?? status}`;

    return NextResponse.json({ log });
  } catch {
    return NextResponse.json({ log: '日志获取失败' }, { status: 500 });
  }
}
