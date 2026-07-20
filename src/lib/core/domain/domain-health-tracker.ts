import { loggers } from '../infra/logger';

const logger = loggers.domainHealth();

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Tracks domain health status (rate-limited vs healthy).
 * Used to prioritize healthy domains and cool down rate-limited ones.
 */
export class DomainHealthTracker {
  private rateLimitedAt = new Map<string, number>();

  readonly cooldownMs: number;

  constructor(cooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Mark a domain as rate-limited.
   */
  markRateLimited(domain: string): void {
    this.rateLimitedAt.set(domain, Date.now());
    logger.warn(`Domain ${domain} marked as rate-limited, cooldown ${this.cooldownMs / 1000}s`);
  }

  /**
   * Mark a domain as healthy (remove rate-limit).
   * @param domain - The domain to mark healthy
   */
  markHealthy(domain: string): void {
    this.rateLimitedAt.delete(domain);
  }

  /**
   * Check if a domain is currently healthy.
   * @param domain - The domain to check
   * @returns true if the domain is healthy (not rate-limited or cooldown expired)
   */
  isHealthy(domain: string): boolean {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return true;
    return Date.now() - limitedAt >= this.cooldownMs;
  }

  /**
   * Get remaining cooldown time for a domain.
   * @param domain - The domain to check
   * @returns Remaining cooldown in milliseconds, 0 if healthy
   */
  getRemainingCooldown(domain: string): number {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return 0;
    const remaining = this.cooldownMs - (Date.now() - limitedAt);
    return Math.max(0, remaining);
  }

  /**
   * Get all domains in ordered priority.
   *
   * Healthy domains are prioritized (shuffled), cooling domains are sorted
   * by remaining cooldown time (ascending) and placed after healthy ones.
   * If all domains are cooling, returns the full list sorted by remaining cooldown.
   *
   * @param domains - Domain list
   * @returns Ordered domain URL list
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

    // Shuffle healthy domains
    const shuffled = shuffleDomainList(healthy);

    cooling.sort((a, b) => a.remaining - b.remaining);

    return [...shuffled, ...cooling.map((c) => c.domain)];
  }

  /**
   * Get all healthy domains (shuffled).
   * @param domains - Domain list
   */
  getHealthyDomains(domains: string[]): string[] {
    return shuffleDomainList(domains.filter((d) => this.isHealthy(d)));
  }

  /**
   * Get the best (highest priority) domain.
   * @param domains - Domain list
   * @returns The best domain URL
   */
  getBestDomain(domains: string[]): string {
    const ordered = this.getAllDomainsOrdered(domains);
    return ordered[0] || domains[0];
  }

  /**
   * Clear all rate-limit records.
   */
  clear(): void {
    this.rateLimitedAt.clear();
  }

  /**
   * Get all currently rate-limited domains with remaining cooldown.
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
 * "Jump room" algorithm: shuffle domain list by rotating from a random start index.
 * Returns a deterministic attempt order that varies per call.
 *
 * @param domains - Domain list to shuffle
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

// Global singleton
import { getOrCreateGlobal } from '../infra/global-singleton';

const GLOBAL_KEY = '__puchipix_domain_health_tracker__';

/**
 * Get the globally shared DomainHealthTracker singleton.
 * Suitable for scenarios requiring cross-module domain health state sharing.
 */
export function getDomainHealthTracker(): DomainHealthTracker {
  return getOrCreateGlobal(GLOBAL_KEY, () => new DomainHealthTracker());
}