import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    const service = getProtagonistService();

    if (name) {
      // 获取指定主角的详细信息
      const stats = await service.getProtagonistStats(name);

      if (!stats) {
        return NextResponse.json(
          { error: '未找到该主角的图库' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: stats,
      });
    } else {
      // 获取所有主角列表
      const protagonists = await service.getAllProtagonists();

      return NextResponse.json({
        success: true,
        data: {
          total: protagonists.length,
          protagonists,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取主角信息失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
