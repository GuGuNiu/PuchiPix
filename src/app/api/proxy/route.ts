/**
 * HLS 代理 API / 本地文件服务
 *
 * 功能：
 * 1. 代理 m3u8 播放列表和 TS 分片请求，添加正确的 Referer 头
 * 2. 提供本地图片文件访问（path 参数）
 *
 * 某些 CDN（如 11yun.space）要求 Referer 为来源站点（如 kanav.ad），
 * 浏览器直接请求会 403。
 *
 * GET /api/proxy?url=<m3u8 或 ts URL>&referer=<来源站点 URL>
 * GET /api/proxy?path=<本地文件路径>
 *
 * @date 2026-07-10
 * @lastModified 2026-07-12
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.searchParams.get('url');
  const filePath = request.nextUrl.searchParams.get('path');
  const referer = request.nextUrl.searchParams.get('referer') || '';

  // 优先处理本地文件路径
  if (filePath) {
    try {
      const resolvedPath = path.resolve(filePath);
      const dataDir = path.resolve('data');
      const relative = path.relative(dataDir, resolvedPath);

      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      if (!existsSync(resolvedPath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const fileBuffer = await readFile(resolvedPath);
      
      // 根据文件扩展名设置 Content-Type
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
      };
      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File read failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!url) {
    return NextResponse.json({ error: 'url or path parameter required' }, { status: 400 });
  }

  try {
    const parsed = new URL(url);
    const isHlsMedia =
      parsed.pathname.endsWith('.m3u8') ||
      parsed.pathname.endsWith('.m3u') ||
      parsed.pathname.endsWith('.ts');

    if (!isHlsMedia) {
      return NextResponse.json({ error: 'Only .m3u8 and .ts URLs are allowed' }, { status: 400 });
    }

    // 优先使用传入的 referer，否则回退到 CDN 域名
    const finalReferer = referer || `${parsed.protocol}//${parsed.host}/`;

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Referer: finalReferer,
        Origin: finalReferer,
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = parsed.pathname.endsWith('.ts')
      ? 'video/mp2t'
      : 'application/vnd.apple.mpegurl';

    const body = await res.arrayBuffer();

    let responseBody: ArrayBuffer = body;
    if (parsed.pathname.endsWith('.m3u8') || parsed.pathname.endsWith('.m3u')) {
      const text = new TextDecoder().decode(body);
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      const proxyBase = `/api/proxy?referer=${encodeURIComponent(finalReferer)}&url=`;

      const rewritten = text.replace(
        /^([^#].+)$/gm,
        (line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return proxyBase + encodeURIComponent(trimmed);
          }
          const fullUrl = new URL(trimmed, baseUrl).href;
          return proxyBase + encodeURIComponent(fullUrl);
        }
      );
      responseBody = new TextEncoder().encode(rewritten).buffer as ArrayBuffer;
    }

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=10',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
