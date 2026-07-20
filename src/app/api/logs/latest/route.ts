import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';


export async function GET(request: Request): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
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
      return NextResponse.json({ log: t('api.logs.systemReady') });
    }

    // Formatlogmessage
    const id = latestTask.seq ?? String(latestTask.id);
    const title = latestTask.videoInfo?.title ?? t('api.logs.taskNumber', { id });
    const status = latestTask.status;
    const time = new Date(latestTask.updatedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const statusMap: Record<string, string> = {
      pending: t('common.pending'),
      scraping: t('common.scraping'),
      downloading: t('common.downloading'),
      paused: t('common.paused'),
      completed: t('common.completed'),
      failed: t('common.failed'),
      cancelled: t('common.cancelled'),
    };

    const log = `[${time}] ${title.slice(0, 20)}${title.length > 20 ? '...' : ''} - ${statusMap[status] ?? status}`;

    return NextResponse.json({ log });
  } catch {
    return NextResponse.json({ log: t('api.logs.fetchFailed') }, { status: 500 });
  }
}