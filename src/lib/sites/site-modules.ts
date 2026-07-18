import type { SiteType, BadgeTheme } from './types';
import siteModulesData from '../data/site-modules.json';

export type { SiteType, BadgeTheme };

export interface SiteModuleConfig {
  readonly id: string;
  readonly nameCn: string;
  readonly nameEn: string;
  readonly baseUrl: string;
  readonly type: SiteType;
  readonly badge: BadgeTheme;
  readonly enabled: boolean;
  readonly domains?: readonly string[];
}

export const SITE_MODULES = siteModulesData.modules as Record<string, SiteModuleConfig>;

export const ALL_SITE_MODULES: readonly SiteModuleConfig[] = Object.values(SITE_MODULES);

export const ENABLED_SITE_MODULES: readonly SiteModuleConfig[] = ALL_SITE_MODULES.filter(
  (m) => m.enabled
);

/**
 * 根据 ID 获取站点模块配置。
 * @param id - 站点 ID
 * @returns 站点模块配置，不存在则返回 undefined
 */
export function getSiteModule(id: string): SiteModuleConfig | undefined {
  return SITE_MODULES[id as keyof typeof SITE_MODULES];
}

/**
 * 获取站点本地化名称
 * @param module - 站点模块配置
 * @returns 本地化的站点名称
 */
export function getSiteModuleName(
  module: SiteModuleConfig,
  locale: string = 'zh-CN'
): string {
  if (locale === 'en-US' || locale === 'ko-KR' || locale === 'ru-RU' || locale === 'de-DE' || locale === 'vi-VN' || locale === 'es-ES' || locale === 'pt-BR' || locale === 'fr-FR' || locale === 'id-ID') {
    return module.nameEn;
  }
  return module.nameCn;
}

export function getSiteModuleByUrl(url: string): SiteModuleConfig | undefined {
  const urlLower = url.toLowerCase();
  return ALL_SITE_MODULES.find((m) => {
    if (m.id === 'universal') return false;
    try {
      const host = new URL(m.baseUrl).hostname.toLowerCase();
      if (urlLower.includes(host)) return true;
    } catch {
    }
    if (m.domains) {
      for (const domain of m.domains) {
        try {
          const host = new URL(domain).hostname.toLowerCase();
          if (urlLower.includes(host)) return true;
        } catch {
        }
      }
    }
    return urlLower.includes(m.id.toLowerCase());
  });
}
