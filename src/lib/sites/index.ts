/**
 * sites/index.ts — 站点模块统一导出
 *
 * 对外暴露站点提供者相关的类型、基类、注册中心。
 */

// 类型定义
export type { SiteProvider, SiteConfig, SiteSearchResult, SiteInfo, GallerySiteProvider, ExtendedMetadata, SeriesItem, SiteType, BadgeTheme } from './types';

// 抽象基类
export { BaseSiteProvider } from './base-provider';

// 站点注册中心
export { getSiteRegistry } from './site-registry';

// 站点模块配置
export { SITE_MODULES, ALL_SITE_MODULES, ENABLED_SITE_MODULES, getSiteModule } from './site-modules';
export type { SiteModuleConfig } from './site-modules';

// 站点提供者
export { KanavProvider } from './providers/kanav-provider';
export { AimeiziziProvider } from './providers/aimeizizi-provider';
