import { NextResponse } from 'next/server';
import { getSiteAccountManager, type AccountStatus } from '@/lib/sites/site-account-manager';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');

    const manager = getSiteAccountManager();

    if (siteId) {
      const accounts = await manager.getAccountsBySiteId(siteId);
      return NextResponse.json(accounts);
    }

    // 无 siteId 时返回所有账户（通过查询所有站点）
    // 目前只有 sjs 站点需要账户管理
    const sjsAccounts = await manager.getAccountsBySiteId('sjs');
    return NextResponse.json(sjsAccounts);
  } catch (err) {
    console.error('[API/accounts] GET 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get accounts' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();

    const { siteId, username, password, domain, cookiePrefix, remark } = body;

    if (!siteId || !username || !password) {
      return NextResponse.json(
        { error: t('api.common.missingParams', { params: 'siteId, username, password' }) },
        { status: 400 },
      );
    }

    const manager = getSiteAccountManager();
    const account = await manager.createAccount(
      siteId,
      username,
      password,
      domain || '',
      cookiePrefix || '',
      remark || '',
    );

    console.log(`[API/accounts] 创建账户成功: #${account.id} (${siteId}/${username})`);
    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    console.error('[API/accounts] POST 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create account' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');

    if (!id) {
      return NextResponse.json(
        { error: t('api.common.missingParams', { params: 'id' }) },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { status, remark } = body;

    const manager = getSiteAccountManager();

    if (status) {
      await manager.updateStatus(id, status as AccountStatus, remark);
    }

    console.log(`[API/accounts] 更新账户 #${id}: status=${status}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/accounts] PATCH 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update account' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '0');

    if (!id) {
      return NextResponse.json(
        { error: t('api.common.missingParams', { params: 'id' }) },
        { status: 400 },
      );
    }

    const manager = getSiteAccountManager();
    await manager.deleteAccount(id);

    console.log(`[API/accounts] 删除账户 #${id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/accounts] DELETE 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete account' },
      { status: 500 },
    );
  }
}
