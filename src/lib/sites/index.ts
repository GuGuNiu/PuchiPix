export type { SiteProvider, SiteConfig, SiteSearchResult, SiteInfo, GallerySiteProvider, ExtendedMetadata, SeriesItem, SiteType, BadgeTheme, BlockCheckResult } from './types';

// 抽象基类
export { BaseSiteProvider } from './base-provider';

// 站点注册中心
export { getSiteRegistry } from './site-registry';

// 站点模块配置
export { SITE_MODULES, ALL_SITE_MODULES, ENABLED_SITE_MODULES, getSiteModule } from './site-modules';
export type { SiteModuleConfig } from './site-modules';

// 站点提供者
export { KanavProvider } from './providers/kanav-provider';
export { AimeiziziProvider, extractDomainFromUrl } from './providers/aimeizizi-provider';
export { UniversalProvider } from './providers/universal-provider';
export { ExhentaiProvider } from './providers/exhentai-provider';
export { SjsProvider, extractThreadId, extractForumId } from './providers/sjs-provider';

// 司机社论坛操作工具（HTTP 登录、签到、购买帖子）
export {
  httpLogin,
  performCheckin,
  checkinAllAccounts,
  buyThread,
  extractDownloadLinksFromPage,
  isThreadPurchasable,
  type CheckinResult,
  type BuyResult,
  type LoginResult,
} from './sjs-actions';

// 账户管理
export { getSiteAccountManager, type CookieData, type AccountInfo, type AccountStatus } from './site-account-manager';

// 屏蔽词库
export { getBlocklistService } from './blocklist-service';
