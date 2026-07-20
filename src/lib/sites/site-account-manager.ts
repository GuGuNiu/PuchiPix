import { prisma } from '@/lib/db/prisma';
import { loggers } from '@/lib/core/infra/logger';
import type { SiteAccount } from '@prisma/client';
import { logT } from '@/lib/i18n/server';


const logger = loggers.siteAccountManager();
export type AccountStatus = 'active' | 'disabled' | 'cooldown' | 'expired' | 'banned';

export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expires?: number;
}

export interface AccountInfo {
  id: number;
  siteId: string;
  username: string;
  domain: string;
  status: AccountStatus;
  cookiePrefix: string;
  lastLoginAt: Date | null;
  lastUsedAt: Date | null;
  failCount: number;
  remark: string;
  hasCookies: boolean;
}

const MAX_FAIL_COUNT = 5;

class SiteAccountManager {
  /**
   *
   * @param siteId - site ID
   */
  async getAvailableAccount(siteId: string): Promise<SiteAccount | null> {
    const accounts = await prisma.siteAccount.findMany({
      where: {
        siteId,
        status: 'active',
      },
      orderBy: [
        { lastUsedAt: 'asc' },
        { lastLoginAt: 'asc' },
        { id: 'asc' },
      ],
    });

    return accounts[0] || null;
  }

  
  async getAccountById(accountId: number): Promise<SiteAccount | null> {
    return prisma.siteAccount.findUnique({
      where: { id: accountId },
    });
  }

  /**
   *
   * @param siteId - site ID
   * @returns Account info array
   */
  async getAccountsBySiteId(siteId: string): Promise<AccountInfo[]> {
    const accounts = await prisma.siteAccount.findMany({
      where: { siteId },
      orderBy: { id: 'asc' },
    });

    return accounts.map((a: typeof accounts[number]) => this.toAccountInfo(a));
  }

  
  async getAccountByDomain(domain: string): Promise<SiteAccount | null> {
    return prisma.siteAccount.findFirst({
      where: {
        domain,
        status: 'active',
      },
      orderBy: [
        { lastUsedAt: 'asc' },
        { id: 'asc' },
      ],
    });
  }

  
  async getAuthCookies(accountId: number): Promise<CookieData[] | null> {
    const account = await prisma.siteAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || !account.authCookies) {
      return null;
    }

    try {
      const cookies = JSON.parse(account.authCookies) as CookieData[];
      if (!Array.isArray(cookies) || cookies.length === 0) {
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const hasValidCookie = cookies.some(
        (c) => !c.expires || c.expires === 0 || c.expires > now,
      );

      return hasValidCookie ? cookies : null;
    } catch {
      return null;
    }
  }

  /**
   *
   * @param cookies - cookie Array
   */
  async saveAuthCookies(
    accountId: number,
    cookies: CookieData[],
    cookiePrefix: string,
  ): Promise<void> {
    const cookiesJson = JSON.stringify(cookies);

    await prisma.siteAccount.update({
      where: { id: accountId },
      data: {
        authCookies: cookiesJson,
        cookiePrefix,
        lastLoginAt: new Date(),
        failCount: 0,
        status: 'active',
      },
    });

    logger.infoT('log.siteAccountManager.cookieSaved', { id: accountId, count: cookies.length });
  }

  
  async markUsed(accountId: number): Promise<void> {
    await prisma.siteAccount.update({
      where: { id: accountId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   *
   * @param reason - Failreason
   */
  async markLoginFailed(accountId: number, reason?: string): Promise<void> {
    const account = await prisma.siteAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) return;

    const newFailCount = account.failCount + 1;
    const shouldDisable = newFailCount >= MAX_FAIL_COUNT;

    await prisma.siteAccount.update({
      where: { id: accountId },
      data: {
        failCount: newFailCount,
        status: shouldDisable ? 'disabled' : account.status,
        remark: shouldDisable
          ? `连续登录失败 ${newFailCount} 次已自动禁用${reason ? ': ' + reason : ''}`
          : account.remark,
      },
    });

    if (shouldDisable) {
      console.warn(
        `[SiteAccountManager] Account #${accountId} auto-disabled after ${newFailCount} consecutive login failures`,
      );
    }
  }

  /**
   *
   * @param status - newState
   */
  async updateStatus(
    accountId: number,
    status: AccountStatus,
    remark?: string,
  ): Promise<void> {
    await prisma.siteAccount.update({
      where: { id: accountId },
      data: {
        status,
        ...(remark !== undefined ? { remark } : {}),
      },
    });
  }

  /**
   *
   * @param siteId - site ID
   * @param username - loginaccount
   * @param password - loginpassword
   * @param domain - Associationdomain
   */
  async createAccount(
    siteId: string,
    username: string,
    password: string,
    domain: string,
    cookiePrefix: string = '',
    remark: string = '',
  ): Promise<AccountInfo> {
    const account = await prisma.siteAccount.create({
      data: {
        siteId,
        username,
        password,
        domain,
        cookiePrefix,
        status: 'active',
        remark,
      },
    });

    return this.toAccountInfo(account);
  }

  
  async deleteAccount(accountId: number): Promise<void> {
    await prisma.siteAccount.delete({
      where: { id: accountId },
    });
  }

  
  private toAccountInfo(account: {
    id: number;
    siteId: string;
    username: string;
    domain: string;
    status: string;
    cookiePrefix: string;
    authCookies: string;
    lastLoginAt: Date | null;
    lastUsedAt: Date | null;
    failCount: number;
    remark: string;
  }): AccountInfo {
    return {
      id: account.id,
      siteId: account.siteId,
      username: account.username,
      domain: account.domain,
      status: account.status as AccountStatus,
      cookiePrefix: account.cookiePrefix,
      lastLoginAt: account.lastLoginAt,
      lastUsedAt: account.lastUsedAt,
      failCount: account.failCount,
      remark: account.remark,
      hasCookies: !!account.authCookies,
    };
  }
}

const GLOBAL_KEY = '__siteAccountManagerInstance__';

export function getSiteAccountManager(): SiteAccountManager {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SiteAccountManager();
  }
  return g[GLOBAL_KEY] as SiteAccountManager;
}
