import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const mem = process.memoryUsage();

  return NextResponse.json({
    memory: {
      alloc_mb: Math.round(mem.heapUsed / (1024 * 1024)),
      sys_mm: Math.round(mem.rss / (1024 * 1024)),
      total_mb: Math.round(mem.heapTotal / (1024 * 1024)),
    },
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
}