import { NextResponse } from 'next/server';
import { getSiteAccountManager } from '@/lib/sites/site-account-manager';
import {
  performCheckin,
  checkinAllAccounts,
  buyThread,
  httpLogin,
  performCheckinWithRetry,
  checkinAllAccountsEnhanced,
  getAntiCrawlerReport,
} from '@/lib/sites/sjs-actions';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
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

        const manager = getSiteAccountManager();
        await manager.markUsed(accountId).catch(() => {});

        return NextResponse.json({ success: true, result });
      }

      case 'checkinEnhanced': {
        if (!accountId) {
          return NextResponse.json(
            { error: t('api.sjs.signMissingAccountId') },
            { status: 400 },
          );
        }

        const { maxRetries, enableJitter } = body;
        const result = await performCheckinWithRetry(accountId, {
          maxRetries: maxRetries ?? 3,
          enableJitter: enableJitter ?? true,
        });

        const manager = getSiteAccountManager();
        await manager.markUsed(accountId).catch(() => {});

        return NextResponse.json({ success: true, result });
      }

      case 'checkinAll': {
        const results = await checkinAllAccounts();
        return NextResponse.json({ success: true, results });
      }

      case 'checkinAllEnhanced': {
        const { maxRetries, enableJitter } = body;
        const results = await checkinAllAccountsEnhanced({
          maxRetries: maxRetries ?? 3,
          enableJitter: enableJitter ?? true,
        });
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

        const account = await manager.getAccountById(accountId);
        if (!account) {
          return NextResponse.json(
            { error: `未找到账户 #${accountId}` },
            { status: 404 },
          );
        }

        const result = await httpLogin(account.username, account.password);

        // LoginSuccessafterSave cookie
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
    console.error('[API/sjs] POST failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to execute SJS action' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report');

    if (report === 'antiCrawler') {
      const antiCrawlerReport = getAntiCrawlerReport();
      return NextResponse.json({
        report: antiCrawlerReport,
        timestamp: new Date().toISOString(),
      });
    }

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
      supportedActions: [
        'checkin',
        'checkinEnhanced',
        'checkinAll',
        'checkinAllEnhanced',
        'buy',
        'login',
      ],
      antiCrawlerReport: getAntiCrawlerReport(),
    });
  } catch (err) {
    console.error('[API/sjs] GET failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get SJS status' },
      { status: 500 },
    );
  }
}
