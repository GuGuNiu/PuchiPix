import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getDownloadManager } from '@/lib/api-helpers';

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
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'paused') {
      return NextResponse.json({ error: 'Task is not paused' }, { status: 400 });
    }

    const dm = getDownloadManager();
    await dm.resumeDownload(taskId);

    return NextResponse.json({ message: 'Download resumed', task_id: taskId });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to resume download' }, { status: 500 });
  }
}