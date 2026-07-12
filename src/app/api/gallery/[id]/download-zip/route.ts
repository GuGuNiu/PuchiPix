/**
 * 图库 ZIP 压缩包下载 API
 *
 * POST /api/gallery/[id]/download-zip
 *   功能: 从中转站下载 ZIP 压缩包并解压到本地
 *   请求体（可选）:
 *     - manualUrl: 手动提供的下载 URL（当数据库中的 URL 需要登录时使用）
 *     - enqueue: 是否通过 OUO 编排器入队（默认 false，直接下载）
 *     - maxRetries: 通过编排器下载时的最大重试次数（默认 2）
 *   返回:
 *     直接下载: { success, status, localPath, extractedPath, actualSize, fileCount, error? }
 *     入队: { queued: true, queuePosition: number }
 *
 * GET /api/gallery/[id]/download-zip
 *   功能: 查询 ZIP 下载状态
 *   返回: { status, localPath, extractedPath, actualSize, fileCount }
 *
 * @date 2026-07-11
 * @lastModified 2026-07-12
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { downloadAndExtractZip } from '@/lib/downloader/zip-downloader';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';
import { detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/gallery/[id]/download-zip — 触发 ZIP 下载并解压
 *
 * @date 2026-07-11
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
      return NextResponse.json({ error: '图库不存在' }, { status: 404 });
    }

    if (!gallery.downloadInfo) {
      return NextResponse.json({ error: '该图库无 ZIP 下载信息' }, { status: 400 });
    }

    const effectiveUrl = manualUrl || gallery.downloadInfo.downloadUrl;
    if (!effectiveUrl) {
      return NextResponse.json(
        { error: '无可用下载 URL，请手动提供中转站链接' },
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
          { error: '仅 ouo.io 来源支持编排器入队，当前来源为 ' + source },
          { status: 400 },
        );
      }

      const orchestrator = getOuoOrchestrator();
      const position = orchestrator.enqueue(galleryId, effectiveUrl, manualUrl, maxRetries);

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
 * @date 2026-07-11
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
      return NextResponse.json({ error: '无 ZIP 下载信息' }, { status: 404 });
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
