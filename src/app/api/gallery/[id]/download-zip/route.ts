/**
 * 图库 ZIP 压缩包下载 API
 *
 * POST /api/gallery/[id]/download-zip — 下载 ZIP 并解压到本地
 * GET /api/gallery/[id]/download-zip — 查询 ZIP 下载状态
 */

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { downloadAndExtractZip } from '@/lib/downloader/zip';
import { getOuoOrchestrator } from '@/lib/core/orchestrator/ouo-orchestrator';
import { detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/gallery/[id]/download-zip — 触发 ZIP 下载并解压
 *
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const manualUrl: string | undefined = body.manualUrl;
    const enqueue: boolean = body.enqueue === true;
    const maxRetries: number | undefined = body.maxRetries;

    // 检查图库和下载信息是否存在
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { downloadInfo: true },
    });

    if (!gallery) {
      return NextResponse.json({ error: t('api.gallery.notFound') }, { status: 404 });
    }

    if (!gallery.downloadInfo) {
      return NextResponse.json({ error: t('api.gallery.noZipInfo') }, { status: 400 });
    }

    const effectiveUrl = manualUrl || gallery.downloadInfo.downloadUrl;
    if (!effectiveUrl) {
      return NextResponse.json(
        { error: t('api.gallery.noDownloadUrl') },
        { status: 400 },
      );
    }

    // 如果提供了手动 URL，保存到数据库
    if (manualUrl && manualUrl !== gallery.downloadInfo.downloadUrl) {
      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: { downloadUrl: manualUrl },
      });
    }

    // 通过 OUO 编排器入队（适用于 ouo.io 来源的批量下载）
    if (enqueue) {
      const source = detectDownloadSource(effectiveUrl);
      if (source !== 'ouo') {
        return NextResponse.json(
          { error: t('api.gallery.invalidSource', { source }) },
          { status: 400 },
        );
      }

      const orchestrator = getOuoOrchestrator();
      const position = orchestrator.enqueueOuo(galleryId, effectiveUrl, manualUrl, maxRetries);

      return NextResponse.json({ queued: true, queuePosition: position });
    }

    // 直接下载（原有行为）
    const result = await downloadAndExtractZip(galleryId, manualUrl);

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZIP download failed';
    const status = message.includes('正在下载') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * GET /api/gallery/[id]/download-zip — 查询 ZIP 下载状态
 *
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const downloadInfo = await prisma.galleryDownloadInfo.findUnique({
      where: { galleryId },
    });

    if (!downloadInfo) {
      return NextResponse.json({ error: t('api.gallery.noZipData') }, { status: 404 });
    }

    return NextResponse.json({
      status: downloadInfo.status,
      localPath: downloadInfo.localPath,
      extractedPath: downloadInfo.extractedPath,
      actualSize: Number(downloadInfo.actualSize),
      fileCount: downloadInfo.fileCount,
      downloadUrl: downloadInfo.downloadUrl,
      downloadSource: downloadInfo.downloadSource,
      ouoUrl: downloadInfo.ouoUrl,
      resolvedDirectUrl: downloadInfo.resolvedDirectUrl,
      zipFileName: downloadInfo.zipFileName,
      parallelism: downloadInfo.parallelism,
      avgSpeed: downloadInfo.avgSpeed,
      verifiedCount: downloadInfo.verifiedCount,
      countMatched: downloadInfo.countMatched,
      provider: downloadInfo.provider,
      requiresLogin: downloadInfo.requiresLogin,
      password: downloadInfo.password,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch ZIP status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
