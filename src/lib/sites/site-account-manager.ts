import { prisma } from '@/lib/db/prisma';
import type { SiteAccount } from '@prisma/client';
import { logT } from '@/lib/i18n/server';

/** 账户状态 */
export type AccountStatus = 'active' | 'disabled' | 'cooldown' | 'expired' | 'banned';

/** Cookie 对象（Playwright 格式） */
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

/** 账户信息（脱敏后，不包含密码） */
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

/** 登录失败自动禁用阈值 */
const MAX_FAIL_COUNT = 5;

class SiteAccountManager {
  /**
   * 获取指定站点的可用账户（active 状态，最久未使用优先）。
   *
   * @param siteId - 站点 ID
   * @returns 账户记录（含密码，供登录使用），无可用账户返回 null
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

  /**
   * 按 ID 获取单个账户（含密码，供登录使用）。
   *
   * @param accountId - 账户 ID
   * @returns 账户记录，不存在返回 null
   */
  async getAccountById(accountId: number): Promise<SiteAccount | null> {
    return prisma.siteAccount.findUnique({
      where: { id: accountId },
    });
  }

  /**
   * 获取指定站点的所有账户信息（脱敏，不含密码）。
   *
   * @param siteId - 站点 ID
   * @returns 账户信息数组
   */
  async getAccountsBySiteId(siteId: string): Promise<AccountInfo[]> {
    const accounts = await prisma.siteAccount.findMany({
      where: { siteId },
      orderBy: { id: 'asc' },
    });

    return accounts.map((a: typeof accounts[number]) => this.toAccountInfo(a));
  }

  /**
   * 获取指定域名的账户。
   *
   * @param domain - 域名（如 https://sjs66.com）
   * @returns 账户记录（含密码），无匹配返回 null
   */
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

  /**
   * 获取账户的认证 Cookie（用于登录态保持）。
   *
   * 如果数据库中存储了 Cookie 且未过期，直接返回；
   * 否则返回 null，调用方需执行登录流程。
   *
   * @param accountId - 账户 ID
   * @returns Cookie 数组，无有效 Cookie 返回 null
   */
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

      // 检查是否有过期 Cookie（expires > 0 且已过期）
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
   * 保存认证 Cookie 到数据库（登录成功后调用）。
   *
   * @param accountId - 账户 ID
   * @param cookies - Cookie 数组
   * @param cookiePrefix - Cookie 前缀（如 "SgL6_2132_"）
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

    console.log(logT('log.siteAccountManager.cookieSaved', { id: accountId, count: cookies.length }));
  }

  /**
   * 标记账户已使用（每次爬取时调用，用于轮转调度）。
   *
   * @param accountId - 账户 ID
   */
  async markUsed(accountId: number): Promise<void> {
    await prisma.siteAccount.update({
      where: { id: accountId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * 记录登录失败（连续失败达到阈值自动禁用）。
   *
   * @param accountId - 账户 ID
   * @param reason - 失败原因
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
          ? `连续登录失败 ${newFailCount} 次，已自动禁用${reason ? ': ' + reason : ''}`
          : account.remark,
      },
    });

    if (shouldDisable) {
      console.warn(
        `[SiteAccountManager] 账户 #${accountId} 连续登录失败 ${newFailCount} 次，已自动禁用`,
      );
    }
  }

  /**
   * 更新账户状态。
   *
   * @param accountId - 账户 ID
   * @param status - 新状态
   * @param remark - 备注（可选）
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
   * 创建新账户。
   *
   * @param siteId - 站点 ID
   * @param username - 登录账号
   * @param password - 登录密码
   * @param domain - 关联域名
   * @param cookiePrefix - Cookie 前缀
   * @returns 创建的账户信息
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

  /**
   * 删除账户。
   *
   * @param accountId - 账户 ID
   */
  async deleteAccount(accountId: number): Promise<void> {
    await prisma.siteAccount.delete({
      where: { id: accountId },
    });
  }

  /**
   * 将数据库记录转换为脱敏的 AccountInfo（不包含密码和 Cookie）。
   */
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

// 单例
const GLOBAL_KEY = '__siteAccountManagerInstance__';

export function getSiteAccountManager(): SiteAccountManager {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SiteAccountManager();
  }
  return g[GLOBAL_KEY] as SiteAccountManager;
}
