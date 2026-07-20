import { NextResponse } from 'next/server';
import { logSink } from '@/lib/core/infra';
import type { StructuredLogEntry, LogQueryFilter, LogLevel } from '@/lib/core/infra';
import type { LogEntry } from '../route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEVEL_MAP: Record<string, LogLevel> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let logSeq = 0;

function toLogEntry(entry: StructuredLogEntry): LogEntry {
  return {
    id: ++logSeq,
    timestamp: entry.timestamp,
    level: entry.level,
    levelValue: entry.levelValue,
    module: entry.module,
    source: entry.module,
    message: entry.message,
    traceId: entry.context.traceId,
    dagId: entry.context.dagId,
    nodeId: entry.context.nodeId,
    taskType: entry.context.taskType,
    phase: entry.context.phase,
    context: entry.context,
    data: entry.data,
    i18nKey: entry.i18nKey,
    i18nParams: entry.i18nParams,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const filter: LogQueryFilter = {
    module: searchParams.get('module') ?? undefined,
    dagId: searchParams.get('dagId') ?? undefined,
    nodeId: searchParams.get('nodeId') ?? undefined,
    traceId: searchParams.get('traceId') ?? undefined,
    taskType: searchParams.get('taskType') ?? undefined,
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 500,
  };

  const levelParam = searchParams.get('level');
  if (levelParam) {
    filter.level = LEVEL_MAP[levelParam.toLowerCase()];
  }

  const entries = logSink.query(filter);
  const logs = entries.map(toLogEntry);

  return NextResponse.json({ success: true, data: logs });
}
