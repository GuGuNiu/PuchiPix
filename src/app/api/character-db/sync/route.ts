import { NextResponse } from 'next/server';
import { getCharacterDBScheduler } from '@/lib/character-db';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const scheduler = getCharacterDBScheduler();
  return NextResponse.json({ running: scheduler.isSyncRunning() });
}

export async function POST(request: Request): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const scheduler = getCharacterDBScheduler();

    if (scheduler.isSyncRunning()) {
      return NextResponse.json(
        { error: t('api.characterDb.syncRunning') },
        { status: 409 },
      );
    }

    let games: string[] | undefined;
    try {
      const body = await request.json();
      games = Array.isArray(body?.games) ? body.games : undefined;
    } catch {
    }

    const syncLog = await scheduler.runSync(games);
    return NextResponse.json(syncLog);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync character database';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
