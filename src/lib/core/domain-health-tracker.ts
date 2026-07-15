/** 默认冷却期（毫秒）：5 分钟 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 域名健康度跟踪器
 *
 * 记录每个域名被限流（403/429）的时间戳，在冷却期内跳过该域名。
 * 冷却期到期后自动恢复为健康状态。
 */
export class DomainHealthTracker {
  /** domain → 被限流的时间戳（毫秒） */
  private rateLimitedAt = new Map<string, number>();

  /** 冷却期（毫秒） */
  readonly cooldownMs: number;

  constructor(cooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * 标记域名为被限流
   *
   * @param domain - 域名（如 'https://www.lovecutes.com'）
   */
  markRateLimited(domain: string): void {
    this.rateLimitedAt.set(domain, Date.now());
    console.warn(`[DomainHealth] 域名 ${domain} 被标记为限流，冷却 ${this.cooldownMs / 1000}s`);
  }

  /**
   * 标记域名为健康（从限流列表中移除）
   *
   * @param domain - 域名
   */
  markHealthy(domain: string): void {
    this.rateLimitedAt.delete(domain);
  }

  /**
   * 检查域名是否健康（未被限流或冷却期已过）
   *
   * @param domain - 域名
   * @returns true 表示健康
   */
  isHealthy(domain: string): boolean {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return true;
    return Date.now() - limitedAt >= this.cooldownMs;
  }

  /**
   * 获取域名的剩余冷却时间（毫秒）
   *
   * @param domain - 域名
   * @returns 剩余冷却毫秒，0 表示已健康
   */
  getRemainingCooldown(domain: string): number {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return 0;
    const remaining = this.cooldownMs - (Date.now() - limitedAt);
    return Math.max(0, remaining);
  }

  /**
   * 获取所有域名的有序列表
   *
   * 健康域名优先（随机打乱），冷却中的域名按剩余冷却时间升序排在后面。
   * 如果所有域名都在冷却中，返回按剩余冷却时间升序排列的完整列表
   * （至少能尝试冷却时间最短的域名）。
   *
   * @param domains - 域名列表
   * @returns 排序后的域名 URL 列表
   */
  getAllDomainsOrdered(domains: string[]): string[] {
    const healthy: string[] = [];
    const cooling: { domain: string; remaining: number }[] = [];

    for (const domain of domains) {
      if (this.isHealthy(domain)) {
        healthy.push(domain);
      } else {
        cooling.push({ domain, remaining: this.getRemainingCooldown(domain) });
      }
    }

    // 健康域名随机打乱
    const shuffled = shuffleDomainList(healthy);

    // 冷却中的域名按剩余时间升序
    cooling.sort((a, b) => a.remaining - b.remaining);

    return [...shuffled, ...cooling.map((c) => c.domain)];
  }

  /**
   * 获取所有健康域名（随机打乱）
   *
   * @param domains - 域名列表
   * @returns 健康域名列表，若全部冷却中则返回空数组
   */
  getHealthyDomains(domains: string[]): string[] {
    return shuffleDomainList(domains.filter((d) => this.isHealthy(d)));
  }

  /**
   * 获取最佳域名
   *
   * 优先返回随机一个健康域名，若全部冷却中则返回剩余冷却时间最短的域名。
   *
   * @param domains - 域名列表
   * @returns 域名 URL
   */
  getBestDomain(domains: string[]): string {
    const ordered = this.getAllDomainsOrdered(domains);
    return ordered[0] || domains[0];
  }

  /**
   * 清除所有限流记录
   */
  clear(): void {
    this.rateLimitedAt.clear();
  }

  /**
   * 获取当前被限流的域名列表
   *
   * @returns 被限流的域名数组（含剩余冷却毫秒数）
   */
  getRateLimitedDomains(): Array<{ domain: string; remainingMs: number }> {
    const now = Date.now();
    const result: Array<{ domain: string; remainingMs: number }> = [];
    for (const [domain, limitedAt] of this.rateLimitedAt) {
      const remaining = Math.max(0, this.cooldownMs - (now - limitedAt));
      if (remaining > 0) {
        result.push({ domain, remainingMs: remaining });
      }
    }
    return result;
  }
}

/**
 * 跳房子算法：随机打乱域名列表，返回尝试顺序
 *
 * 每次调用产生不同的起始位置，避免固定模式被识别。
 *
 * @param domains - 待打乱的域名列表
 * @returns 随机起始的域名列表
 */
export function shuffleDomainList(domains: string[]): string[] {
  if (domains.length <= 1) return [...domains];
  const shuffled = [...domains];
  const startIdx = Math.floor(Math.random() * shuffled.length);
  return [
    ...shuffled.slice(startIdx),
    ...shuffled.slice(0, startIdx),
  ];
}

// 全局单例
import { getOrCreateGlobal } from './global-singleton';

const GLOBAL_KEY = '__puchipix_domain_health_tracker__';

/**
 * 获取全局共享的 DomainHealthTracker 单例
 *
 * 适用于需要跨模块共享域名健康状态的场景。
 */
export function getGlobalDomainHealthTracker(): DomainHealthTracker {
  return getOrCreateGlobal(GLOBAL_KEY, () => new DomainHealthTracker());
}
