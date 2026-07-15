import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager } from '@/lib/api-helpers';

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

    if (!dm.isDownloading(taskId)) {
      return NextResponse.json({ message: 'Task is not downloading, skipped', task_id: taskId, skipped: true });
    }

    dm.pauseDownload(taskId);

    return NextResponse.json({ message: 'Download paused', task_id: taskId });
  } catch {
    return NextResponse.json({ error: 'Failed to pause download' }, { status: 500 });
  }
}
