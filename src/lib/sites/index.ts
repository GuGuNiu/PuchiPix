export type { SiteProvider, SiteConfig, SiteSearchResult, SiteInfo, GallerySiteProvider, ExtendedMetadata, SeriesItem, SiteType, BadgeTheme, BlockCheckResult } from './types';

export { BaseSiteProvider } from './base-provider';

// 站点注册中心
export { getSiteRegistry } from './site-registry';

// 站点模块配置
export { SITE_MODULES, ALL_SITE_MODULES, ENABLED_SITE_MODULES, getSiteModule } from './site-modules';
export type { SiteModuleConfig } from './site-modules';

// 站点提供者
export { KanavProvider } from './providers/kanav-provider';
export { AimeiziziProvider } from './providers/aimeizizi-provider';
export { extractDomainFromUrl } from './providers/aimeizizi/constants';
export { UniversalProvider } from './providers/universal-provider';
export { ExhentaiProvider } from './providers/exhentai-provider';
export { extractGalleryId, normalizeToEhentai, isExUrl, CATEGORY_LABELS, CATEGORY_NAMES } from './providers/exhentai-provider/constants';
export { SjsProvider } from './providers/sjs-provider';
export { extractThreadId, extractForumId } from './providers/sjs-provider/constants';

export {
  httpLogin,
  performCheckin,
  checkinAllAccounts,
  buyThread,
  extractDownloadLinks,
  isThreadPurchasable,
  type CheckinResult,
  type BuyResult,
  type LoginResult,
} from './sjs-actions';

// 账户管理
export { getSiteAccountManager, type CookieData, type AccountInfo, type AccountStatus } from './site-account-manager';

// 屏蔽词库
export { getBlocklistService } from './blocklist-service';
