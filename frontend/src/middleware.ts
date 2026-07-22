import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Securityheaderand CORS Middleware
 *
 *
 */

const DEFAULT_ALLOWED_ORIGINS = "http://localhost:10540";

function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: https: http:",
    "connect-src 'self' ws: wss: http: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function applySecurityHeaders(headers: Headers, isDev: boolean): void {
  headers.set("Content-Security-Policy", buildCsp(isDev));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!isDev) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function applyCors(headers: Headers, request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin)) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
}

export function middleware(request: NextRequest): NextResponse {
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    applyCors(response.headers, request);
    return response;
  }

  const response = NextResponse.next();
  const isDev = process.env.NODE_ENV !== "production";
  applySecurityHeaders(response.headers, isDev);
  applyCors(response.headers, request);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|vendor/).*)",
  ],
};
