/**
 * config/route.ts — 应用配置 API
 *
 * GET /api/config — 获取配置
 * PUT /api/config — 更新配置
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import type { AppConfig } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 默认配置 */
const DEFAULT_CONFIG: Record<string, string> = {
  max_concurrent: '5',
  segment_retries: '5',
  default_format: 'mp4',
  download_path: './data/videos',
  segments_path: './data/segments',
  ffmpeg_path: 'ffmpeg',
};

export async function GET(): Promise<NextResponse> {
  try {
    const configs = await prisma.appConfig.findMany();
    const result: AppConfig = { ...DEFAULT_CONFIG };

    for (const config of configs) {
      result[config.key] = config.value;
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to read config' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body: Record<string, string> = await request.json();
    const operations = [];

    for (const [key, value] of Object.entries(body)) {
      operations.push(
        prisma.appConfig.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      );
    }

    await Promise.all(operations);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
