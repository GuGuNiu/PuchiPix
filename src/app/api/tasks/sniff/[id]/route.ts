import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const sniffId = parseInt(id, 10);
    if (isNaN(sniffId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    taskQueueManager.cancelAcquire('sniff', sniffId);

    await prisma.sniffTask.delete({ where: { id: sniffId } });

    // 通知 SSE 流推送 delete 事件，让前端确认删除
    eventBus.emit('sniffTask:deleted', { sniffId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete sniff task' }, { status: 500 });
  }
}
