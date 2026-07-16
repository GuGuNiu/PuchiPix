import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { setServerLocaleFromHeaders } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;

    const where = category ? { category } : {};
    const prefs = await prisma.userPreference.findMany({ where });

    const result: Record<string, string> = {};
    for (const p of prefs) {
      result[p.key] = p.value;
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body: Record<string, { value: string; category?: string }> = await request.json();
    const operations = [];

    for (const [key, meta] of Object.entries(body)) {
      const category = meta.category ?? "general";
      operations.push(
        prisma.userPreference.upsert({
          where: { key },
          create: { key, value: String(meta.value), category },
          update: { value: String(meta.value), category },
        })
      );
    }

    await Promise.all(operations);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }
    await prisma.userPreference.delete({ where: { key } });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete preference";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
