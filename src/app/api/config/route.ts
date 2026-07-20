import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { validateStringMap } from "@/lib/api/validation";
import type { AppConfig } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Defaultconfig */
const DEFAULT_CONFIG: Record<string, string> = {
  max_concurrent: "5",
  segment_retries: "5",
  default_format: "mp4",
  download_path: "./data/videos",
  segments_path: "./data/segments",
  ffmpeg_path: "ffmpeg",
};

const ALLOWED_CONFIG_KEYS: readonly string[] = Object.keys(DEFAULT_CONFIG);

export async function GET(): Promise<NextResponse> {
  try {
    const configs = await prisma.appConfig.findMany();
    const result: AppConfig = { ...DEFAULT_CONFIG };

    for (const config of configs) {
      result[config.key] = config.value;
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to read config" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = validateStringMap(body, ALLOWED_CONFIG_KEYS);
    if (!parsed.ok) {
      return parsed.response;
    }

    const entries = Object.entries(parsed.value);
    if (entries.length === 0) {
      return NextResponse.json({ success: true });
    }

    await Promise.all(
      entries.map(([key, value]) =>
        prisma.appConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
