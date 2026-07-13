/**
 * sites/site-modules.ts — 站点模块顶层配置
 *
 * 集中管理每个站点模块的展示元信息：
 * - 中文名 / 英文名
 * - 站点 URL
 * - 站点类型（写真站 / 视频站）
 * - 徽章配色（渐变色 + 实色 + 文字色）
 * - 是否启用
 *
 * 新增站点时，在此文件添加一条 SITE_MODULES 记录即可，
 * Provider 类中不再硬编码展示信息。
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

// ============================================================
// 类型定义
// ============================================================

/** 站点类型 */
export type SiteType = 'photo' | 'video';

/** 徽章配色方案 */
export interface BadgeTheme {
  /** 渐变色 CSS 值，用于徽章背景 */
  gradient: string;
  /** 实色兜底，用于不支持渐变的场景 */
  solidColor: string;
  /** 徽章上的文字颜色 */
  textColor: string;
}

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

// ============================================================
// 站点模块注册表
// ============================================================

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
    nameEn: 'Aimeizizi',
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
} as const satisfies Record<string, SiteModuleConfig>;

// ============================================================
// 辅助函数
// ============================================================

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
 * 根据 URL 匹配站点模块，支持多域名自适应。
 *
 * 检查顺序：baseUrl hostname → domains 列表中所有 hostname → 站点 ID 子串匹配
 *
 * @param url - 任意 URL（任务 URL、源页面 URL 等）
 * @returns 匹配到的站点模块配置，未匹配则返回 undefined
 *
 * @date 2026-07-12
 */
export function getSiteModuleByUrl(url: string): SiteModuleConfig | undefined {
  const urlLower = url.toLowerCase();
  return ALL_SITE_MODULES.find((m) => {
    try {
      const host = new URL(m.baseUrl).hostname.toLowerCase();
      if (urlLower.includes(host)) return true;
    } catch {
      // ignore
    }
    if (m.domains) {
      for (const domain of m.domains) {
        try {
          const host = new URL(domain).hostname.toLowerCase();
          if (urlLower.includes(host)) return true;
        } catch {
          // ignore
        }
      }
    }
    return urlLower.includes(m.id.toLowerCase());
  });
}
