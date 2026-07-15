import prisma from '@/lib/db/prisma';
import type { BlockCheckResult } from './types';

const CACHE_TTL_MS = 60_000;

interface CachedRules {
  rules: RuleEntry[];
  fetchedAt: number;
}

interface RuleEntry {
  siteId: string;
  fieldType: 'title' | 'category' | 'protagonist' | 'director';
  keyword: string;
  matchMode: 'includes' | 'exact' | 'regex';
}

class BlocklistService {
  private cache: CachedRules | null = null;
  private fetchPromise: Promise<CachedRules> | null = null;

  async getRules(): Promise<RuleEntry[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.rules;
    }

    if (!this.fetchPromise) {
      this.fetchPromise = this.fetchRules().finally(() => {
        this.fetchPromise = null;
      });
    }
    const result = await this.fetchPromise;
    return result.rules;
  }

  private async fetchRules(): Promise<CachedRules> {
    const rows = await prisma.blocklistRule.findMany({
      where: { enabled: true },
      select: {
        siteId: true,
        fieldType: true,
        keyword: true,
        matchMode: true,
      },
    });

    const rules: RuleEntry[] = rows.map((r) => ({
      siteId: r.siteId,
      fieldType: r.fieldType as RuleEntry['fieldType'],
      keyword: r.keyword,
      matchMode: r.matchMode as RuleEntry['matchMode'],
    }));

    const cached: CachedRules = { rules, fetchedAt: Date.now() };
    this.cache = cached;
    return cached;
  }

  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * 用数据库中的用户自定义规则检查内容是否应被屏蔽。
   *
   * 仅检查用户自定义规则，不包含默认配置关键词。
   * 默认配置的检查仍由各 Provider 的 checkBlocked 方法完成。
   *
   * @param siteId - 当前站点 ID
   * @param fields - 待检查的字段值
   * @returns 屏蔽检查结果
   */
  async checkUserRules(
    siteId: string,
    fields: {
      title?: string;
      category?: string;
      protagonist?: string;
      director?: string;
    },
  ): Promise<BlockCheckResult> {
    const rules = await this.getRules();
    if (rules.length === 0) return { blocked: false, reason: undefined };

    const applicableRules = rules.filter(
      (r) => r.siteId === 'all' || r.siteId === siteId,
    );
    if (applicableRules.length === 0) return { blocked: false, reason: undefined };

    const fieldMap: Record<string, string | undefined> = {
      title: fields.title,
      category: fields.category,
      protagonist: fields.protagonist,
      director: fields.director,
    };

    for (const rule of applicableRules) {
      const value = fieldMap[rule.fieldType];
      if (!value) continue;

      if (this.matches(value, rule.keyword, rule.matchMode)) {
        return {
          blocked: true,
          reason: `${rule.fieldType} 命中用户自定义屏蔽规则: "${rule.keyword}"`,
        };
      }
    }

    return { blocked: false, reason: undefined };
  }

  private matches(value: string, keyword: string, mode: string): boolean {
    switch (mode) {
      case 'exact':
        return value === keyword;
      case 'regex':
        try {
          return new RegExp(keyword, 'i').test(value);
        } catch {
          return false;
        }
      case 'includes':
      default:
        return value.toLowerCase().includes(keyword.toLowerCase());
    }
  }

  async getAll(): Promise<{
    id: number;
    siteId: string;
    fieldType: string;
    keyword: string;
    matchMode: string;
    enabled: boolean;
    remark: string;
    createdAt: string;
    updatedAt: string;
  }[]> {
    const rules = await prisma.blocklistRule.findMany({
      orderBy: [{ siteId: 'asc' }, { fieldType: 'asc' }, { createdAt: 'desc' }],
    });

    return rules.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      fieldType: r.fieldType,
      keyword: r.keyword,
      matchMode: r.matchMode,
      enabled: r.enabled,
      remark: r.remark,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(data: {
    siteId: string;
    fieldType: string;
    keyword: string;
    matchMode?: string;
    remark?: string;
  }): Promise<void> {
    await prisma.blocklistRule.create({
      data: {
        siteId: data.siteId,
        fieldType: data.fieldType,
        keyword: data.keyword,
        matchMode: data.matchMode || 'includes',
        remark: data.remark || '',
      },
    });
    this.invalidateCache();
  }

  async update(id: number, data: {
    enabled?: boolean;
    siteId?: string;
    fieldType?: string;
    keyword?: string;
    matchMode?: string;
    remark?: string;
  }): Promise<void> {
    const updateData: Record<string, unknown> = {};
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.siteId !== undefined) updateData.siteId = data.siteId;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.keyword !== undefined) updateData.keyword = data.keyword;
    if (data.matchMode !== undefined) updateData.matchMode = data.matchMode;
    if (data.remark !== undefined) updateData.remark = data.remark;

    await prisma.blocklistRule.update({
      where: { id },
      data: updateData,
    });
    this.invalidateCache();
  }

  async delete(id: number): Promise<void> {
    await prisma.blocklistRule.delete({ where: { id } });
    this.invalidateCache();
  }

  async batchDelete(ids: number[]): Promise<void> {
    await prisma.blocklistRule.deleteMany({
      where: { id: { in: ids } },
    });
    this.invalidateCache();
  }
}

let instance: BlocklistService | null = null;

export function getBlocklistService(): BlocklistService {
  if (!instance) {
    instance = new BlocklistService();
  }
  return instance;
}
