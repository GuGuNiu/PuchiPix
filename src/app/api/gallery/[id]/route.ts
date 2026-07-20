﻿import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { safeDeleteDir, safeDeleteFile, summarizeDeleteResults } from '@/lib/utils/safe-delete';
import { detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';
import { ensureDir } from '@/lib/utils/file-system';
import { ErrorCode, isAppError } from '@/lib/core/error-codes';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';
import type { GalleryData } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
};

const COVER_CACHE_DIR = './data/cover_cache';

const etagCache = new Map<number, { etag: string; ts: number }>();
const ETAG_CACHE_TTL = 60_000;

function getCachePath(galleryId: number, url: string): string {
  const ext = (() => {
    try {
      const cleanUrl = url.split('?')[0].split('#')[0];
      const e = path.extname(cleanUrl).toLowerCase();
      if (e && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(e)) return e;
    } catch {}
    return '.jpg';
  })();
  return path.join(COVER_CACHE_DIR, `${galleryId}${ext}`);
}

function downloadRemoteCover(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let referer = '';
    try {
      const parsed = new URL(url);
      referer = `${parsed.protocol}//${parsed.host}/`;
    } catch {}

    const protocol = url.startsWith('https://') ? https : http;
    const request = protocol.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': referer,
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors',
          'sec-fetch-site': 'same-origin',
        },
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadRemoteCover(absoluteRedirect, destPath).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          resolve(false);
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(true); });
        fileStream.on('error', () => { fs.unlink(destPath, () => {}); resolve(false); });
      },
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

async function handleCover(request: NextRequest, galleryId: number): Promise<NextResponse> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { coverLocalPath: true, coverUrl: true },
  });

  if (!gallery) {
    return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
  }

  let coverPath = gallery.coverLocalPath;
  const coverUrl = gallery.coverUrl;

  if (!coverPath || !fs.existsSync(coverPath)) {
    if (!coverUrl) {
      return NextResponse.json({ error: 'No cover available' }, { status: 404 });
    }

    const cachePath = getCachePath(galleryId, coverUrl);
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
      coverPath = cachePath;
    } else {
      ensureDir(COVER_CACHE_DIR);
      const downloaded = await downloadRemoteCover(coverUrl, cachePath);
      if (!downloaded || !fs.existsSync(cachePath)) {
        return NextResponse.redirect(coverUrl, 302);
      }
      coverPath = cachePath;
      prisma.gallery.update({
        where: { id: galleryId },
        data: { coverLocalPath: cachePath },
      }).catch(() => {});
    }
  }

  const stat = await fs.promises.stat(coverPath);
  const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

  const cached = etagCache.get(galleryId);
  if (cached && Date.now() - cached.ts < ETAG_CACHE_TTL && cached.etag === etag) {
  }

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    etagCache.set(galleryId, { etag, ts: Date.now() });
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  }

  etagCache.set(galleryId, { etag, ts: Date.now() });

  const ext = path.extname(coverPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  const imageBuffer = await fs.promises.readFile(coverPath);

  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=86400, immutable',
      ETag: etag,
      'Access-Control-Allow-Origin': '*',
    },
  });
}


function mapGalleryWithRelations(g: {
  id: number;
  seq?: string | null;
  sourceUrl: string;
  siteId: string;
  scrapedDomain: string;
  title: string;
  protagonist: string;
  description: string;
  category: string;
  tags: string;
  coverUrl: string;
  coverLocalPath: string;
  gameCharacters: string | null;
  publishTime: string | null;
  imageCount: number;
  videoCount: number;
  pageCount: number;
  status: string;
  downloadMethod: string;
  expectedImageCount: number;
  expectedVideoCount: number;
  contentVerified: boolean;
  savePath: string;
  totalSize: bigint;
  downloadedSize: bigint;
  createdAt: Date;
  updatedAt: Date;
  images: {
    id: number;
    galleryId: number;
    url: string;
    localPath: string;
    fileName: string;
    pageIndex: number;
    orderIndex: number;
    status: string;
  }[];
  videos: {
    id: number;
    galleryId: number;
    url: string;
    localPath: string;
    fileName: string;
    status: string;
  }[];
  downloadInfo?: {
    id: number;
    galleryId: number;
    title: string;
    fileCount: number;
    fileSizeText: string;
    imageDimensions: string;
    password: string;
    downloadUrl: string;
    downloadSource: string;
    ouoUrl: string;
    resolvedDirectUrl: string;
    provider: string;
    requiresLogin: boolean;
    requiresEmail: boolean;
    status: string;
    localPath: string;
    extractedPath: string;
    actualSize: bigint;
    zipFileName: string;
    parallelism: number;
    avgSpeed: number;
    verifiedCount: number;
    countMatched: boolean;
  } | null;
}): GalleryData {
  let tags: string[] = [];
  try {
    tags = g.tags ? JSON.parse(g.tags) as string[] : [];
  } catch {
    tags = [];
  }

  let gameCharacters: string[] = [];
  try {
    gameCharacters = g.gameCharacters ? JSON.parse(g.gameCharacters) as string[] : [];
  } catch {
    gameCharacters = [];
  }

  return {
    ID: g.id,
    Seq: g.seq ?? undefined,
    SourceURL: g.sourceUrl,
    SiteID: g.siteId,
    ScrapedDomain: g.scrapedDomain || '',
    Title: g.description || g.title,
    Protagonist: g.protagonist,
    Description: g.description,
    Category: g.category,
    Tags: tags,
    CoverURL: g.coverUrl,
    CoverLocalPath: g.coverLocalPath || '',
    PublishTime: g.publishTime || undefined,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    PageCount: g.pageCount,
    Status: g.status,
    DownloadMethod: g.downloadMethod || 'pending',
    ExpectedImageCount: g.expectedImageCount || 0,
    ExpectedVideoCount: g.expectedVideoCount || 0,
    ContentVerified: g.contentVerified || false,
    SavePath: g.savePath,
    TotalSize: Number(g.totalSize || BigInt(0)),
    DownloadedSize: Number(g.downloadedSize || BigInt(0)),
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    Images: g.images.map((img) => ({
      ID: img.id,
      GalleryID: img.galleryId,
      URL: img.url,
      LocalPath: img.localPath,
      FileName: img.fileName,
      PageIndex: img.pageIndex,
      OrderIndex: img.orderIndex,
      Status: img.status,
    })),
    Videos: g.videos.map((vid) => ({
      ID: vid.id,
      GalleryID: vid.galleryId,
      URL: vid.url,
      LocalPath: vid.localPath,
      FileName: vid.fileName,
      Status: vid.status,
    })),
    DownloadInfo: g.downloadInfo ? {
      ID: g.downloadInfo.id,
      GalleryID: g.downloadInfo.galleryId,
      Title: g.downloadInfo.title,
      FileCount: g.downloadInfo.fileCount,
      FileSizeText: g.downloadInfo.fileSizeText,
      ImageDimensions: g.downloadInfo.imageDimensions,
      Password: g.downloadInfo.password,
      DownloadURL: g.downloadInfo.downloadUrl,
      DownloadSource: g.downloadInfo.downloadSource || 'unknown',
      OuoURL: g.downloadInfo.ouoUrl || '',
      ResolvedDirectURL: g.downloadInfo.resolvedDirectUrl || '',
      Provider: g.downloadInfo.provider,
      RequiresLogin: g.downloadInfo.requiresLogin,
      RequiresEmail: g.downloadInfo.requiresEmail,
      Status: g.downloadInfo.status,
      LocalPath: g.downloadInfo.localPath,
      ExtractedPath: g.downloadInfo.extractedPath,
      ActualSize: Number(g.downloadInfo.actualSize || BigInt(0)),
      ZipFileName: g.downloadInfo.zipFileName || '',
      Parallelism: g.downloadInfo.parallelism || 0,
      AvgSpeed: g.downloadInfo.avgSpeed || 0,
      VerifiedCount: g.downloadInfo.verifiedCount || 0,
      CountMatched: g.downloadInfo.countMatched || false,
    } : undefined,
    GameCharacters: gameCharacters,
  };
}


async function handleDownload(request: NextRequest, gid: number): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const concurrency = body.concurrency;

  const gallery = await prisma.gallery.findUnique({
    where: { id: gid },
    select: { id: true, status: true },
  });

  if (!gallery) {
    return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
  }

  workerManager.send({
    type: 'gallery:download',
    payload: { galleryId: gid, concurrency },
  });

  return NextResponse.json({ message: t('api.gallery.downloadStarted'), galleryId: gid });
}


async function handlePause(gid: number): Promise<NextResponse> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: gid },
    select: { id: true },
  });

  if (!gallery) {
    return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
  }

  workerManager.send({
    type: 'gallery:action',
    payload: { galleryId: gid, action: 'pause' },
  });

  return NextResponse.json({ message: 'Gallery paused', galleryId: gid });
}


async function handleResume(_request: NextRequest, gid: number): Promise<NextResponse> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: gid },
    select: { id: true, status: true },
  });

  if (!gallery) {
    return NextResponse.json({ error: t('api.gallery.notFound') }, { status: 404 });
  }

  workerManager.send({
    type: 'gallery:action',
    payload: { galleryId: gid, action: 'resume' },
  });

  return NextResponse.json({ message: 'Gallery resumed', galleryId: gid });
}


async function handleRetryFailed(_request: NextRequest, gid: number): Promise<NextResponse> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: gid },
    select: { id: true },
  });

  if (!gallery) {
    return NextResponse.json({ error: t('api.gallery.notFound') }, { status: 404 });
  }

  workerManager.send({
    type: 'gallery:action',
    payload: { galleryId: gid, action: 'retry-failed' },
  });

  return NextResponse.json({ message: t('api.gallery.retryFailedStarted'), galleryId: gid });
}


async function handleDownloadZip(request: NextRequest, gid: number): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const manualUrl: string | undefined = body.manualUrl;
  const enqueue: boolean = body.enqueue === true;
  const maxRetries: number | undefined = body.maxRetries;

  const gallery = await prisma.gallery.findUnique({
    where: { id: gid },
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

  if (enqueue) {
    const source = detectDownloadSource(effectiveUrl);
    if (source !== 'ouo') {
      return NextResponse.json(
        { error: t('api.gallery.invalidSource', { source }) },
        { status: 400 },
      );
    }
  }

  if (manualUrl && manualUrl !== gallery.downloadInfo.downloadUrl) {
    await prisma.galleryDownloadInfo.update({
      where: { galleryId: gid },
      data: { downloadUrl: manualUrl },
    });
  }

  workerManager.send({
    type: 'gallery:action',
    payload: { galleryId: gid, action: 'download-zip', manualUrl, enqueue, maxRetries },
  });

  if (enqueue) {
    return NextResponse.json({ queued: true, galleryId: gid });
  }

  return NextResponse.json({ message: t('api.gallery.downloadStarted'), galleryId: gid });
}


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const { id } = await params;
    const gid = parseInt(id, 10);

    if (isNaN(gid)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { action = 'download', ...rest } = body;

    const innerRequest = new NextRequest(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(rest),
    });

    switch (action) {
      case 'download':
        return handleDownload(innerRequest, gid);
      case 'pause':
        return handlePause(gid);
      case 'resume':
        return handleResume(innerRequest, gid);
      case 'retry-failed':
        return handleRetryFailed(innerRequest, gid);
      case 'download-zip':
        return handleDownloadZip(innerRequest, gid);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Gallery action failed';
    const code = isAppError(error) && error.code === ErrorCode.ERR_ALREADY_DOWNLOADING ? 409 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get('type') === 'cover') {
      return handleCover(request, galleryId);
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        images: { orderBy: { orderIndex: 'asc' } },
        videos: { orderBy: { id: 'asc' } },
        downloadInfo: true,
      },
    });

    if (!gallery) {
      return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
    }

    return NextResponse.json({ data: mapGalleryWithRelations(gallery) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch gallery';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/gallery/[id] — UpdateGraphlibrary

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'reparseProtagonist': {
        const gallery = await prisma.gallery.findUnique({
          where: { id: galleryId },
          select: { title: true, tags: true },
        });

        if (!gallery) {
          return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
        }

        let tags: string[] = [];
        try {
          tags = JSON.parse(gallery.tags) as string[];
        } catch {
          tags = [];
        }

        const { getProtagonistService } = await import('@/lib/protagonist');
        const service = getProtagonistService();
        const newProtagonist = await service.extractFromTitleSmart(gallery.title, tags);

        if (newProtagonist) {
          service.learnPerson(newProtagonist).catch(() => { });
        }

        await prisma.gallery.update({
          where: { id: galleryId },
          data: { protagonist: newProtagonist },
        });

        return NextResponse.json({
          data: {
            galleryId,
            oldProtagonist: (await prisma.gallery.findUnique({
              where: { id: galleryId },
              select: { protagonist: true },
            }))?.protagonist || '',
            newProtagonist,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update gallery';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/gallery/[id] — DeleteGraphlibrary

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const galleryId = parseInt(id);

  if (isNaN(galleryId)) {
    return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
  }

  try {
    workerManager.send({
      type: 'gallery:action',
      payload: { galleryId, action: 'pause' },
    });

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        downloadInfo: true,
      },
    });

    if (!gallery) {
      eventBus.emit('gallery:deleted', { galleryId });
      return NextResponse.json({ success: true });
    }

    const galleryRoot = process.env.GALLERY_PATH || './data/galleries';
    const zipRoot = process.env.GALLERY_ZIP_PATH || './data/gallery_zips';
    const resolvedGalleryRoot = path.resolve(galleryRoot);
    const resolvedZipRoot = path.resolve(zipRoot);

    const deleteResults = [];

    if (gallery.savePath) {
      const savePathResolved = path.resolve(gallery.savePath);
      if (savePathResolved.startsWith(resolvedGalleryRoot) || savePathResolved.startsWith(resolvedZipRoot)) {
        deleteResults.push(await safeDeleteDir(savePathResolved));
      } else {
        deleteResults.push(await safeDeleteDir(savePathResolved));
      }
    }

    if (gallery.downloadInfo) {
      if (gallery.downloadInfo.localPath) {
        const zipPath = path.resolve(gallery.downloadInfo.localPath);
        if (zipPath.startsWith(resolvedZipRoot) || zipPath.startsWith(resolvedGalleryRoot)) {
          deleteResults.push(await safeDeleteFile(zipPath));
        } else {
          deleteResults.push(await safeDeleteFile(zipPath));
        }
      }

      if (gallery.downloadInfo.extractedPath) {
        const extractPath = path.resolve(gallery.downloadInfo.extractedPath);
        deleteResults.push(await safeDeleteDir(extractPath));
      }
    }

    const tempZipDir = path.join(resolvedZipRoot, `gallery_${galleryId}`);
    deleteResults.push(await safeDeleteDir(tempZipDir));

    console.log(`[GalleryDelete] Gallery #${galleryId}: ${summarizeDeleteResults(deleteResults)}`);

    await prisma.$transaction(async (tx) => {
      await tx.gallery.delete({
        where: { id: galleryId },
      });
    });

    eventBus.emit('gallery:deleted', { galleryId });

    console.log(`[GalleryDelete] Gallery #${galleryId} deletion completed`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete gallery';
    console.error(`[GalleryDelete] Gallery #${galleryId} deletion failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
