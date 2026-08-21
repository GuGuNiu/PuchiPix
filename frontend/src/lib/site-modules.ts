/**
 * Site Modules Service
 *
 * Fetches full site configuration (including domains list) from GET /api/sites at startup.
 * Backend is the single source of truth for site information.
 */

import { createLogger } from "@/lib/core/infra";

const logger = createLogger("SiteModules");

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

// In-memory cache populated at startup
let siteModules: Record<string, SiteModuleConfig> = {};
let allModules: SiteModuleConfig[] = [];
let loaded = false;

/**
 * Fetch site configuration from backend at startup.
 * Call from app entry point (e.g., useEffect in root layout).
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
    logger.error("Failed to fetch /api/sites, fallback to empty", { error: err });
    loaded = true;
  }
}

/**
 * Get site module by ID (synchronous, available after initSiteModules completes).
 */
export function getSiteModule(id: string): SiteModuleConfig | undefined {
  return siteModules[id];
}

/**
 * Get display name for a site module based on locale.
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
 * Find matching site module by URL (iterates baseUrl + domains list).
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
          // baseUrl may be empty
        }
    if (m.domains) {
      for (const domain of m.domains) {
        try {
          const host = new URL(domain).hostname.toLowerCase();
          if (hostMatches(hostname, host)) return true;
        } catch {
          // Invalid domain, skip
        }
      }
    }
    return false;
  });
}

/**
 * Get all enabled site modules.
 */
export function getAllSiteModules(): SiteModuleConfig[] {
  return allModules;
}

/**
 * Get currently loaded modules array for static access scenarios.
 * Ensure initSiteModules() has completed before first access.
 */
export function getEnabledSiteModules(): readonly SiteModuleConfig[] {
  return allModules;
}

/**
 * Check if initialization is complete.
 */
export function isSiteModulesLoaded(): boolean {
  return loaded;
}
