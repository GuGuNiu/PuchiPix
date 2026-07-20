import type { SiteProvider, SiteInfo } from './types';
import { loggers } from '@/lib/core/infra/logger';
import { getSiteModule, ALL_SITE_MODULES } from './site-modules';
import { KanavProvider } from './providers/kanav-provider';
import { AimeiziziProvider } from './providers/aimeizizi-provider';
import { UniversalProvider } from './providers/universal-provider';
import { ExhentaiProvider } from './providers/exhentai-provider';
import { SjsProvider } from './providers/sjs-provider';
import { logT } from '@/lib/i18n/server';


const logger = loggers.siteRegistry();
class SiteRegistry {
  private providers: Map<string, SiteProvider> = new Map();

  /**
   * @param provider - siteProviderinstance
   */
  register(provider: SiteProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * @param id - site ID
   */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * @param id - site ID
   */
  getProvider(id: string): SiteProvider | undefined {
    return this.providers.get(id);
  }

  
  getProviderByUrl(url: string): SiteProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.matchesUrl(url)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Get allRegister siteProvider。
   * @returns siteProviderArray
   */
  getAllProviders(): SiteProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get allenabled siteProvider。
   * @returns enabled siteProviderArray
   */
  getEnabledProviders(): SiteProvider[] {
    return this.getAllProviders().filter((p) => p.enabled);
  }

  /**
   *
   * @returns siteinfoArray
   */
  getSiteInfos(): SiteInfo[] {
    return this.getAllProviders().map((p) => {
      const mod = getSiteModule(p.id);
      const gallery = typeof (p as { scrapeGallery?: unknown }).scrapeGallery === 'function';
      return {
        id: p.id,
        name: mod?.nameCn ?? p.name,
        nameCn: mod?.nameCn ?? p.name,
        nameEn: mod?.nameEn ?? p.name,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        type: mod?.type ?? (gallery ? 'photo' : 'video'),
        badge: mod?.badge ?? {
          gradient: 'linear-gradient(135deg, #64748b, #475569)',
          solidColor: '#64748b',
          textColor: '#ffffff',
        },
        gallery,
      };
    });
  }

  /**
   * @returns enabledsite infoArray
   */
  getEnabledSiteInfos(): SiteInfo[] {
    return this.getSiteInfos().filter((s) => s.enabled);
  }
}

const REGISTRY_KEY = '__siteRegistryInstance__';

export function getSiteRegistry(): SiteRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) {
    const registry = new SiteRegistry();
    registerDefaultProviders(registry);
    g[REGISTRY_KEY] = registry;
  }
  return g[REGISTRY_KEY] as SiteRegistry;
}

/**
 * RegisteralldefaultsiteProvider。
 *
 *   registry.register(new XxxProvider());
 *
 *
 * @param registry - siteRegistercenter
 */
function registerDefaultProviders(registry: SiteRegistry): void {
  for (const mod of ALL_SITE_MODULES) {
    switch (mod.id) {
      case 'kanav':
        registry.register(new KanavProvider());
        break;
      case 'aimeizizi':
        registry.register(new AimeiziziProvider());
        break;
      case 'universal':
        registry.register(new UniversalProvider());
        break;
      case 'exhentai':
        registry.register(new ExhentaiProvider());
        break;
      case 'sjs':
        registry.register(new SjsProvider());
        break;
      default:
        logger.warnT('log.siteRegistry.providerNotFound', { id: mod.id });
    }
  }
}
