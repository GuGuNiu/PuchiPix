/**
 * Site Modules Service - 全后端驱动
 *
 * 启动时从 GET /api/sites 拉取完整站点配置（含 domains 列表），
 * 不再依赖静态 JSON 文件。后端是站点信息的唯一真实来源。
 */

export interface BadgeTheme {
  gradient: string;
  solidColor: string;
  textColor: string;
}

export interface SiteModuleConfig {
  readonly id: string;
  readonly nameCn: string;
  readonly nameEn: string;
  readonly baseUrl: string;
  readonly type: string;
  readonly badge: BadgeTheme;
  readonly enabled: boolean;
  readonly domains?: readonly string[];
  readonly gallery?: boolean;
}

// ── In-memory cache populated at startup ──
let siteModules: Record<string, SiteModuleConfig> = {};
let allModules: SiteModuleConfig[] = [];
let loaded = false;

/**
 * 启动时调用：从后端 /api/sites 拉取完整站点配置。
 * 应在应用入口（如 _app.tsx 或 main.tsx）通过 useEffect 调用。
 */
export async function initSiteModules(): Promise<void> {
  try {
    const res = await fetch('/api/sites');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: SiteModuleConfig[] = await res.json();
    siteModules = {};
    allModules = [];
    for (const mod of data) {
      if (!mod.enabled) continue;
      siteModules[mod.id] = mod;
      allModules.push(mod);
    }
    loaded = true;
  } catch (err) {
    console.error('[site-modules] Failed to fetch /api/sites, fallback to empty:', err);
    loaded = true;
  }
}

/**
 * 同步获取（initSiteModules 完成后可用）
 */
export function getSiteModule(id: string): SiteModuleConfig | undefined {
  return siteModules[id];
}

/**
 * 根据站点模块获取显示名称（按语言切换中/英文）
 */
export function getSiteModuleName(
  module: SiteModuleConfig,
  locale: string = 'zh-CN'
): string {
  const nonChinese = ['en-US', 'ko-KR', 'ru-RU', 'de-DE', 'vi-VN', 'es-ES', 'pt-BR', 'fr-FR', 'id-ID'];
  if (nonChinese.includes(locale)) {
    return module.nameEn;
  }
  return module.nameCn;
}

function hostMatches(hostname: string, configuredHost: string): boolean {
  return hostname === configuredHost || hostname.endsWith(`.${configuredHost}`);
}

function hostnameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * 根据 URL 查找匹配的站点模块（遍历 baseUrl + domains 列表）
 */
export function getSiteModuleByUrl(url: string): SiteModuleConfig | undefined {
  const hostname = hostnameFromUrl(url);
  if (!hostname) return undefined;

  return allModules.find((m) => {
    if (m.id === 'universal') return false;
    try {
      const host = new URL(m.baseUrl).hostname.toLowerCase();
      if (hostMatches(hostname, host)) return true;
    } catch {
      // baseUrl 可能为空
    }
    if (m.domains) {
      for (const domain of m.domains) {
        try {
          const host = new URL(domain).hostname.toLowerCase();
          if (hostMatches(hostname, host)) return true;
        } catch {
          // ignore invalid domain
        }
      }
    }
    return false;
  });
}

/**
 * 获取全部已启用的站点模块（兼容旧 API）
 */
export function getAllSiteModules(): SiteModuleConfig[] {
  return allModules;
}

/**
 * 兼容旧 API：返回全部已启用模块的只读数组
 * @deprecated 建议使用 getAllSiteModules()
 */
export const ENABLED_SITE_MODULES: readonly SiteModuleConfig[] = Object.freeze([]);

/**
 * 内部使用：获取当前已加载的模块数组（用于 constants.ts 等需要静态访问的场景）
 * 注意：首次访问前需确保 initSiteModules() 已完成
 */
export function getEnabledSiteModules(): readonly SiteModuleConfig[] {
  return allModules;
}

/**
 * 检查是否已初始化完成
 */
export function isSiteModulesLoaded(): boolean {
  return loaded;
}
