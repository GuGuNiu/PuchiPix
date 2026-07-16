import { NextResponse } from 'next/server';
import { getSiteAccountManager } from '@/lib/sites/site-account-manager';
import {
  performCheckin,
  checkinAllAccounts,
  buyThread,
  httpLogin,
} from '@/lib/sites/sjs-actions';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST — 执行司机社论坛操作 */
export async function POST(request: Request): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { action, accountId, tid } = body;

    if (!action) {
      return NextResponse.json(
        { error: t('api.sjs.missingAction') },
        { status: 400 },
      );
    }

    switch (action) {
            case 'checkin': {
        if (!accountId) {
          return NextResponse.json(
            { error: t('api.sjs.signMissingAccountId') },
            { status: 400 },
          );
        }

        const result = await performCheckin(accountId);

        // 更新账户使用时间
        const manager = getSiteAccountManager();
        await manager.markUsed(accountId).catch(() => {});

        return NextResponse.json({ success: true, result });
      }

      case 'checkinAll': {
        const results = await checkinAllAccounts();
        return NextResponse.json({ success: true, results });
      }

      case 'buy': {
        if (!accountId) {
          return NextResponse.json(
            { error: t('api.sjs.buyMissingAccountId') },
            { status: 400 },
          );
        }
        if (!tid) {
          return NextResponse.json(
            { error: t('api.sjs.buyMissingTid') },
            { status: 400 },
          );
        }

        const result = await buyThread(accountId, String(tid));

        // 更新账户使用时间
        const manager = getSiteAccountManager();
        await manager.markUsed(accountId).catch(() => {});

        return NextResponse.json({ success: true, result });
      }

            case 'login': {
        if (!accountId) {
          return NextResponse.json(
            { error: t('api.sjs.loginMissingAccountId') },
            { status: 400 },
          );
        }

        const manager = getSiteAccountManager();

        // 按 ID 获取完整账户信息（含密码）
        const account = await manager.getAccountById(accountId);
        if (!account) {
          return NextResponse.json(
            { error: `未找到账户 #${accountId}` },
            { status: 404 },
          );
        }

        const result = await httpLogin(account.username, account.password);

        // 登录成功后保存 Cookie
        if (result.success && result.cookies) {
          await manager.saveAuthCookies(
            accountId,
            result.cookies,
            'SgL6_2132_',
          );
        }

        return NextResponse.json({ success: result.success, result });
      }

      default:
        return NextResponse.json(
          { error: `未知操作: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[API/sjs] POST 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to execute SJS action' },
      { status: 500 },
    );
  }
}

/** GET — 获取司机社操作状态信息 */
export async function GET(): Promise<NextResponse> {
  try {
    const manager = getSiteAccountManager();
    const accounts = await manager.getAccountsBySiteId('sjs');

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        username: a.username,
        status: a.status,
        hasCookies: a.hasCookies,
        lastLoginAt: a.lastLoginAt,
        lastUsedAt: a.lastUsedAt,
      })),
      supportedActions: ['checkin', 'checkinAll', 'buy', 'login'],
    });
  } catch (err) {
    console.error('[API/sjs] GET 失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get SJS status' },
      { status: 500 },
    );
  }
}
