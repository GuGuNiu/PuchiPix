/**
 * 图库封面图服务 API
 *
 * GET /api/gallery/[id]/cover
 *   功能: 返回图库封面图片，优先本地文件，无本地文件时代理远程 URL 并缓存
 *   返回: 图片二进制流
 *
 * 性能优化：
 * - 异步文件读取（fs.promises），不阻塞事件循环
 * - ETag 基于 size+mtime，支持 304 Not Modified
 * - 远程封面代理 + 磁盘缓存，避免重复请求远程站点
 * - 24h 浏览器缓存
 *
 * @date 2026-07-12
 * @lastModified 2026-07-12
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 远程封面缓存目录 */
const COVER_CACHE_DIR = './data/cover_cache';

/** 内存级 ETag 缓存，避免同一图库短时间内重复查库 */
const etagCache = new Map<number, { etag: string; ts: number }>();
const ETAG_CACHE_TTL = 60_000;

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

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

/**
 * 异步下载远程封面图到缓存目录
 *
 * 携带同域 Referer 绕过防盗链
 */
function downloadRemoteCover(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let referer = '';
    try {
      const parsed = new URL(url);
      referer = `${parsed.protocol}//${parsed.host}/`;
    } catch {
      referer = '';
    }

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
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });
        fileStream.on('error', () => {
          fs.unlink(destPath, () => {});
          resolve(false);
        });
      },
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { coverLocalPath: true, coverUrl: true },
    });

    if (!gallery) {
      return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
    }

    // 确定封面文件路径：优先本地下载的封面，其次远程缓存
    let coverPath = gallery.coverLocalPath;
    let coverUrl = gallery.coverUrl;

    if (!coverPath || !fs.existsSync(coverPath)) {
      // 本地封面不存在，尝试远程缓存
      if (!coverUrl) {
        return NextResponse.json({ error: 'No cover available' }, { status: 404 });
      }

      const cachePath = getCachePath(galleryId, coverUrl);
      if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
        coverPath = cachePath;
      } else {
        // 下载远程封面到缓存
        ensureDir(COVER_CACHE_DIR);
        const downloaded = await downloadRemoteCover(coverUrl, cachePath);
        if (!downloaded || !fs.existsSync(cachePath)) {
          // 下载失败，302 重定向到远程 URL 让浏览器直接加载
          return NextResponse.redirect(coverUrl, 302);
        }
        coverPath = cachePath;

        // 异步更新数据库 coverLocalPath（不阻塞响应）
        prisma.gallery.update({
          where: { id: galleryId },
          data: { coverLocalPath: cachePath },
        }).catch(() => {});
      }
    }

    // 异步读取文件状态用于 ETag
    const stat = await fs.promises.stat(coverPath);
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

    // 检查 ETag 缓存
    const cached = etagCache.get(galleryId);
    if (cached && Date.now() - cached.ts < ETAG_CACHE_TTL && cached.etag === etag) {
      // 快速路径：ETag 未变，但仍需检查 If-None-Match
    }

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      etagCache.set(galleryId, { etag, ts: Date.now() });
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    }

    etagCache.set(galleryId, { etag, ts: Date.now() });

    const ext = path.extname(coverPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    // 异步读取文件，不阻塞事件循环
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to serve cover';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
