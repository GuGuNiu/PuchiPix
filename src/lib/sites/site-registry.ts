import type { SiteProvider, SiteInfo, GallerySiteProvider } from './types';
import { getSiteModule, ALL_SITE_MODULES } from './site-modules';
import { KanavProvider } from './providers/kanav-provider';
import { AimeiziziProvider } from './providers/aimeizizi-provider';
import { UniversalProvider } from './providers/universal-provider';
import { ExhentaiProvider } from './providers/exhentai-provider';
import { SjsProvider } from './providers/sjs-provider';
import { logT } from '@/lib/i18n/server';

class SiteRegistry {
  /** 已注册的提供者 Map（id → provider） */
  private providers: Map<string, SiteProvider> = new Map();

  /**
   * 注册一个站点提供者。
   * @param provider - 站点提供者实例
   */
  register(provider: SiteProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 注销一个站点提供者。
   * @param id - 站点 ID
   */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * 根据 ID 获取站点提供者。
   * @param id - 站点 ID
   * @returns 站点提供者，不存在则返回 undefined
   */
  getProvider(id: string): SiteProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * 根据 URL 自动匹配站点提供者。
   *
   * 遍历所有已注册的提供者，调用 matchesUrl 判断是否匹配。
   * 如果没有匹配的提供者，返回 undefined（调用方可使用通用逻辑处理）。
   *
   * @param url - 视频/搜索页面 URL
   * @returns 匹配的站点提供者，无匹配则返回 undefined
   */
  getProviderByUrl(url: string): SiteProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.matchesUrl(url)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * 获取所有已注册的站点提供者。
   * @returns 站点提供者数组
   */
  getAllProviders(): SiteProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 获取所有已启用的站点提供者。
   * @returns 已启用的站点提供者数组
   */
  getEnabledProviders(): SiteProvider[] {
    return this.getAllProviders().filter((p) => p.enabled);
  }

  /**
   * 获取所有站点的轻量信息（用于前端展示）。
   *
   * 合并 Provider 运行时信息与 site-modules.ts 中的展示元信息
   * （中英文名、徽章配色、站点类型）。
   * @returns 站点信息数组
   */
  getSiteInfos(): SiteInfo[] {
    return this.getAllProviders().map((p) => {
      const mod = getSiteModule(p.id);
      const gallery = typeof (p as unknown as GallerySiteProvider).scrapeGallery === 'function';
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
   * 获取已启用站点的轻量信息。
   * @returns 已启用站点的信息数组
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
 * 注册所有默认站点提供者。
 *
 * 在此添加新站点：
 *   registry.register(new XxxProvider());
 *
 * 同时需在 site-modules.ts 中添加对应的展示配置。
 *
 * @param registry - 站点注册中心
 */
function registerDefaultProviders(registry: SiteRegistry): void {
  // 遍历 site-modules 配置，注册对应的 Provider
  for (const mod of ALL_SITE_MODULES) {
    switch (mod.id) {
      case 'kanav':
        registry.register(new KanavProvider());
        break;
      case 'aimeizizi':
        registry.register(new AimeiziziProvider());
        break;
      case 'universal':
        // 通用下载器注册到 registry 以便 getSiteInfos 包含它，
        // 但其 matchesUrl 始终返回 false，不参与 URL 路由
        registry.register(new UniversalProvider());
        break;
      case 'exhentai':
        registry.register(new ExhentaiProvider());
        break;
      case 'sjs':
        registry.register(new SjsProvider());
        break;
      default:
        console.warn(logT('log.siteRegistry.providerNotFound', { id: mod.id }));
    }
  }
}
