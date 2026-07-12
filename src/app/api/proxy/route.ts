/**
 * HLS 代理 API
 *
 * 代理 m3u8 播放列表和 TS 分片请求，添加正确的 Referer 头。
 * 某些 CDN（如 11yun.space）要求 Referer 为来源站点（如 kanav.ad），
 * 浏览器直接请求会 403。
 *
 * GET /api/proxy?url=<m3u8 或 ts URL>&referer=<来源站点 URL>
 *
 * @date 2026-07-10
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.searchParams.get('url');
  const referer = request.nextUrl.searchParams.get('referer') || '';

  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
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
