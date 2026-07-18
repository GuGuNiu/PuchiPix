/** 榛樿鍐峰嵈鏈燂紙姣锛夛細5 鍒嗛挓 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 鍩熷悕鍋ュ悍搴﹁窡韪櫒
 *
 * 璁板綍姣忎釜鍩熷悕琚檺娴侊紙403/429锛夌殑鏃堕棿鎴筹紝鍦ㄥ喎鍗存湡鍐呰烦杩囪鍩熷悕銆?
 * 鍐峰嵈鏈熷埌鏈熷悗鑷姩鎭㈠涓哄仴搴风姸鎬併€?
 */
export class DomainHealthTracker {
  /** domain 鈫?琚檺娴佺殑鏃堕棿鎴筹紙姣锛?*/
  private rateLimitedAt = new Map<string, number>();

  /** 鍐峰嵈鏈燂紙姣锛?*/
  readonly cooldownMs: number;

  constructor(cooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * 鏍囪鍩熷悕涓鸿闄愭祦
   *
   * @param domain - 鍩熷悕锛堝 'https://www.lovecutes.com'锛?
   */
  markRateLimited(domain: string): void {
    this.rateLimitedAt.set(domain, Date.now());
    console.warn(`[DomainHealth] 鍩熷悕 ${domain} 琚爣璁颁负闄愭祦锛屽喎鍗?${this.cooldownMs / 1000}s`);
  }

  /**
   * 鏍囪鍩熷悕涓哄仴搴凤紙浠庨檺娴佸垪琛ㄤ腑绉婚櫎锛?
   *
   * @param domain - 鍩熷悕
   */
  markHealthy(domain: string): void {
    this.rateLimitedAt.delete(domain);
  }

  /**
   * 妫€鏌ュ煙鍚嶆槸鍚﹀仴搴凤紙鏈闄愭祦鎴栧喎鍗存湡宸茶繃锛?
   *
   * @param domain - 鍩熷悕
   * @returns true 琛ㄧず鍋ュ悍
   */
  isHealthy(domain: string): boolean {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return true;
    return Date.now() - limitedAt >= this.cooldownMs;
  }

  /**
   * 鑾峰彇鍩熷悕鐨勫墿浣欏喎鍗存椂闂达紙姣锛?
   *
   * @param domain - 鍩熷悕
   * @returns 鍓╀綑鍐峰嵈姣锛? 琛ㄧず宸插仴搴?
   */
  getRemainingCooldown(domain: string): number {
    const limitedAt = this.rateLimitedAt.get(domain);
    if (!limitedAt) return 0;
    const remaining = this.cooldownMs - (Date.now() - limitedAt);
    return Math.max(0, remaining);
  }

  /**
   * 鑾峰彇鎵€鏈夊煙鍚嶇殑鏈夊簭鍒楄〃
   *
   * 鍋ュ悍鍩熷悕浼樺厛锛堥殢鏈烘墦涔憋級锛屽喎鍗翠腑鐨勫煙鍚嶆寜鍓╀綑鍐峰嵈鏃堕棿鍗囧簭鎺掑湪鍚庨潰銆?
   * 濡傛灉鎵€鏈夊煙鍚嶉兘鍦ㄥ喎鍗翠腑锛岃繑鍥炴寜鍓╀綑鍐峰嵈鏃堕棿鍗囧簭鎺掑垪鐨勫畬鏁村垪琛?
   * 锛堣嚦灏戣兘灏濊瘯鍐峰嵈鏃堕棿鏈€鐭殑鍩熷悕锛夈€?
   *
   * @param domains - 鍩熷悕鍒楄〃
   * @returns 鎺掑簭鍚庣殑鍩熷悕 URL 鍒楄〃
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

    // 鍋ュ悍鍩熷悕闅忔満鎵撲贡
    const shuffled = shuffleDomainList(healthy);

    // 鍐峰嵈涓殑鍩熷悕鎸夊墿浣欐椂闂村崌搴?
    cooling.sort((a, b) => a.remaining - b.remaining);

    return [...shuffled, ...cooling.map((c) => c.domain)];
  }

  /**
   * 鑾峰彇鎵€鏈夊仴搴峰煙鍚嶏紙闅忔満鎵撲贡锛?
   *
   * @param domains - 鍩熷悕鍒楄〃
   * @returns 鍋ュ悍鍩熷悕鍒楄〃锛岃嫢鍏ㄩ儴鍐峰嵈涓垯杩斿洖绌烘暟缁?
   */
  getHealthyDomains(domains: string[]): string[] {
    return shuffleDomainList(domains.filter((d) => this.isHealthy(d)));
  }

  /**
   * 鑾峰彇鏈€浣冲煙鍚?
   *
   * 浼樺厛杩斿洖闅忔満涓€涓仴搴峰煙鍚嶏紝鑻ュ叏閮ㄥ喎鍗翠腑鍒欒繑鍥炲墿浣欏喎鍗存椂闂存渶鐭殑鍩熷悕銆?
   *
   * @param domains - 鍩熷悕鍒楄〃
   * @returns 鍩熷悕 URL
   */
  getBestDomain(domains: string[]): string {
    const ordered = this.getAllDomainsOrdered(domains);
    return ordered[0] || domains[0];
  }

  /**
   * 娓呴櫎鎵€鏈夐檺娴佽褰?
   */
  clear(): void {
    this.rateLimitedAt.clear();
  }

  /**
   * 鑾峰彇褰撳墠琚檺娴佺殑鍩熷悕鍒楄〃
   *
   * @returns 琚檺娴佺殑鍩熷悕鏁扮粍锛堝惈鍓╀綑鍐峰嵈姣鏁帮級
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
 * 璺虫埧瀛愮畻娉曪細闅忔満鎵撲贡鍩熷悕鍒楄〃锛岃繑鍥炲皾璇曢『搴?
 *
 * 姣忔璋冪敤浜х敓涓嶅悓鐨勮捣濮嬩綅缃紝閬垮厤鍥哄畾妯″紡琚瘑鍒€?
 *
 * @param domains - 寰呮墦涔辩殑鍩熷悕鍒楄〃
 * @returns 闅忔満璧峰鐨勫煙鍚嶅垪琛?
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

// 鍏ㄥ眬鍗曚緥
import { getOrCreateGlobal } from '../infra/global-singleton';

const GLOBAL_KEY = '__puchipix_domain_health_tracker__';

/**
 * 鑾峰彇鍏ㄥ眬鍏变韩鐨?DomainHealthTracker 鍗曚緥
 *
 * 閫傜敤浜庨渶瑕佽法妯″潡鍏变韩鍩熷悕鍋ュ悍鐘舵€佺殑鍦烘櫙銆?
 */
export function getDomainHealthTracker(): DomainHealthTracker {
  return getOrCreateGlobal(GLOBAL_KEY, () => new DomainHealthTracker());
}
