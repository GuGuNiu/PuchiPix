﻿import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// DELETE /api/tasks/sniff?id=123

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const sniffId = id ? parseInt(id, 10) : NaN;

    if (isNaN(sniffId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    taskQueueManager.cancelAcquire('sniff', sniffId);

    await prisma.sniffTask.delete({ where: { id: sniffId } });

    eventBus.emit('sniffTask:deleted', { sniffId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete sniff task' }, { status: 500 });
  }
}
