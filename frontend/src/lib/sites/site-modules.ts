import siteModulesData from '../data/site-modules.json';

export type SiteType = string;
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
 * @param id - site ID
 */
export function getSiteModule(id: string): SiteModuleConfig | undefined {
  return SITE_MODULES[id as keyof typeof SITE_MODULES];
}

/**
 * @param module - sitemoduleconfig
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
