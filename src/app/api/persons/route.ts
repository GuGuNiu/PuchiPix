import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/persons — 查询人物列表 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const source = searchParams.get('source') || '';
    const confirmed = searchParams.get('confirmed');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50')));

    const where: {
      name?: { contains: string };
      source?: string;
      confirmed?: boolean;
    } = {};

    if (q) {
      where.name = { contains: q };
    }
    if (source) {
      where.source = source;
    }
    if (confirmed !== null && confirmed !== undefined) {
      where.confirmed = confirmed === 'true';
    }

    const [persons, total] = await Promise.all([
      prisma.person.findMany({
        where,
        orderBy: [{ galleryCount: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.person.count({ where }),
    ]);

    return NextResponse.json({
      data: persons.map((p) => ({
        id: p.id,
        name: p.name,
        pinyin: p.pinyin,
        aliases: (() => {
          try {
            return JSON.parse(p.aliases) as string[];
          } catch {
            return [];
          }
        })(),
        source: p.source,
        sourceGame: p.sourceGame,
        galleryCount: p.galleryCount,
        confirmed: p.confirmed,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch persons';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/persons — 添加新人物 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, source, sourceGame } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const pinyinStr = getProtagonistService().toStandardPinyin(name);

    const person = await prisma.person.upsert({
      where: { name },
      create: {
        name,
        pinyin: pinyinStr,
        aliases: '[]',
        source: source || 'manual',
        sourceGame: sourceGame || null,
        galleryCount: 0,
        confirmed: true,
      },
      update: {
        pinyin: pinyinStr,
        confirmed: true,
      },
    });

    // 刷新缓存
    await getProtagonistService().refreshCache();

    return NextResponse.json({
      data: {
        id: person.id,
        name: person.name,
        pinyin: person.pinyin,
        source: person.source,
        sourceGame: person.sourceGame,
        galleryCount: person.galleryCount,
        confirmed: person.confirmed,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create person';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/persons — 更新人物（确认/取消确认/删除/导入游戏角色） */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { action, id, name } = body;

    switch (action) {
      case 'confirm': {
        if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        await prisma.person.update({
          where: { id: parseInt(id) },
          data: { confirmed: true },
        });
        await getProtagonistService().refreshCache();
        return NextResponse.json({ message: 'Person confirmed' });
      }

      case 'unconfirm': {
        if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        await prisma.person.update({
          where: { id: parseInt(id) },
          data: { confirmed: false },
        });
        await getProtagonistService().refreshCache();
        return NextResponse.json({ message: 'Person unconfirmed' });
      }

      case 'delete': {
        if (!id && !name) {
          return NextResponse.json({ error: 'ID or name is required' }, { status: 400 });
        }
        if (id) {
          await prisma.person.delete({ where: { id: parseInt(id) } });
        } else {
          await prisma.person.delete({ where: { name } });
        }
        await getProtagonistService().refreshCache();
        return NextResponse.json({ message: 'Person deleted' });
      }

      case 'importGameCharacters': {
        const service = getProtagonistService();
        const count = await service.importGameCharacters();
        return NextResponse.json({ message: `Imported ${count} game characters` });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update person';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
