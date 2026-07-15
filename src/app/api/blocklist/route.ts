import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getBlocklistService } from '@/lib/sites/blocklist-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const service = getBlocklistService();
    const rules = await service.getAll();
    return NextResponse.json({ data: rules });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch blocklist rules';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { siteId, fieldType, keyword, matchMode, remark } = body;

    if (!fieldType || !keyword) {
      return NextResponse.json(
        { error: 'fieldType and keyword are required' },
        { status: 400 },
      );
    }

    const validFieldTypes = ['title', 'category', 'protagonist', 'director'];
    if (!validFieldTypes.includes(fieldType)) {
      return NextResponse.json(
        { error: `fieldType must be one of: ${validFieldTypes.join(', ')}` },
        { status: 400 },
      );
    }

    const validMatchModes = ['includes', 'exact', 'regex'];
    const mode = matchMode || 'includes';
    if (!validMatchModes.includes(mode)) {
      return NextResponse.json(
        { error: `matchMode must be one of: ${validMatchModes.join(', ')}` },
        { status: 400 },
      );
    }

    if (matchMode === 'regex') {
      try {
        new RegExp(keyword);
      } catch {
        return NextResponse.json(
          { error: 'Invalid regex pattern' },
          { status: 400 },
        );
      }
    }

    const service = getBlocklistService();
    await service.create({
      siteId: siteId || 'all',
      fieldType,
      keyword,
      matchMode: mode,
      remark: remark || '',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { id, enabled, siteId, fieldType, keyword, matchMode, remark } = body;

    if (!id || typeof id !== 'number') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (fieldType) {
      const validFieldTypes = ['title', 'category', 'protagonist', 'director'];
      if (!validFieldTypes.includes(fieldType)) {
        return NextResponse.json(
          { error: `fieldType must be one of: ${validFieldTypes.join(', ')}` },
          { status: 400 },
        );
      }
    }

    if (matchMode) {
      const validMatchModes = ['includes', 'exact', 'regex'];
      if (!validMatchModes.includes(matchMode)) {
        return NextResponse.json(
          { error: `matchMode must be one of: ${validMatchModes.join(', ')}` },
          { status: 400 },
        );
      }
    }

    if (matchMode === 'regex' && keyword) {
      try {
        new RegExp(keyword);
      } catch {
        return NextResponse.json(
          { error: 'Invalid regex pattern' },
          { status: 400 },
        );
      }
    }

    const service = getBlocklistService();
    await service.update(id, {
      enabled,
      siteId,
      fieldType,
      keyword,
      matchMode,
      remark,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    const idsParam = searchParams.get('ids');

    const service = getBlocklistService();

    if (idsParam) {
      const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      if (ids.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
      }
      await service.batchDelete(ids);
      return NextResponse.json({ success: true, deleted: ids.length });
    }

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }
      await service.delete(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'id or ids parameter is required' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
