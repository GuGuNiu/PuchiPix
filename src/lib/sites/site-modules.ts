import type { SiteType, BadgeTheme } from './types';

export type { SiteType, BadgeTheme };

/** 站点模块完整配置 */
export interface SiteModuleConfig {
  /** 站点唯一标识（与 SiteProvider.id 一致） */
  readonly id: string;
  /** 中文名（如 "爱妹子"） */
  readonly nameCn: string;
  /** 英文名（如 "Aimeizizi"） */
  readonly nameEn: string;
  /** 站点基础 URL（主域名） */
  readonly baseUrl: string;
  /** 站点类型：photo = 写真站，video = 视频站 */
  readonly type: SiteType;
  /** 徽章配色方案 */
  readonly badge: BadgeTheme;
  /** 是否启用 */
  readonly enabled: boolean;
  /** 镜像域名列表（用于多域名自适应） */
  readonly domains?: readonly string[];
}

export const SITE_MODULES = {
  kanav: {
    id: 'kanav',
    nameCn: 'KanAV',
    nameEn: 'KanAV',
    baseUrl: 'https://kanav.ad',
    type: 'video' as const,
    badge: {
      gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
      solidColor: '#2563eb',
      textColor: '#ffffff',
    },
    enabled: true,
  },

  aimeizizi: {
    id: 'aimeizizi',
    nameCn: '爱妹子',
    nameEn: 'LoveCutes',
    baseUrl: 'https://www.lovecutes.com',
    type: 'photo' as const,
    badge: {
      gradient: 'linear-gradient(135deg, #e91e63, #f8bbd0)',
      solidColor: '#e91e63',
      textColor: '#ffffff',
    },
    enabled: true,
    domains: [
      'https://www.lovecutes.com',
      'https://xx.knit.bid',
      'https://www.lovecutes.net',
    ],
  },

  universal: {
    id: 'universal',
    nameCn: '通用下载器',
    nameEn: 'Universal',
    baseUrl: '',
    type: 'video' as const,
    badge: {
      gradient: 'linear-gradient(135deg, #10b981, #059669)',
      solidColor: '#059669',
      textColor: '#ffffff',
    },
    enabled: true,
  },

  exhentai: {
    id: 'exhentai',
    nameCn: 'E-Hentai',
    nameEn: 'E-Hentai',
    baseUrl: 'https://e-hentai.org',
    type: 'photo' as const,
    badge: {
      gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      solidColor: '#6366f1',
      textColor: '#ffffff',
    },
    enabled: true,
    domains: [
      'https://e-hentai.org',
      'https://exhentai.org',
    ],
  },

  sjs: {
    id: 'sjs',
    nameCn: '司机社',
    nameEn: 'SJS',
    baseUrl: 'https://sjs66.com',
    type: 'photo' as const,
    badge: {
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
      solidColor: '#d97706',
      textColor: '#ffffff',
    },
    enabled: true,
    domains: [
      'https://sjs66.com',
      'https://sjs47.com',
      'https://sjs47.net',
      'https://sjslt.cc',
      'https://xsijishe.net',
    ],
  },
} as const satisfies Record<string, SiteModuleConfig>;

/** 所有站点模块配置数组 */
export const ALL_SITE_MODULES: readonly SiteModuleConfig[] = Object.values(SITE_MODULES);

/** 已启用的站点模块配置数组 */
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
 * @param locale - 语言代码 ('zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP')
 * @returns 本地化的站点名称
 */
export function getSiteModuleName(
  module: SiteModuleConfig,
  locale: string = 'zh-CN'
): string {
  if (locale === 'en-US') {
    return module.nameEn;
  }
  return module.nameCn;
}

/**
 * 根据 URL 匹配站点模块，支持多域名自适应。
 *
 * 检查顺序：baseUrl hostname → domains 列表中所有 hostname → 站点 ID 子串匹配
 *
 * @param url - 任意 URL（任务 URL、源页面 URL 等）
 * @returns 匹配到的站点模块配置，未匹配则返回 undefined
 */
export function getSiteModuleByUrl(url: string): SiteModuleConfig | undefined {
  const urlLower = url.toLowerCase();
  // 跳过 universal 模块（它不绑定特定域名，仅作为兜底）
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
