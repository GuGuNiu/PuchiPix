/*
 * Site module config (frontend, config-only)
 * All provider logic, registry, blocklist, account management, SJS actions
 * migrated to Go backend at localhost:10541/api/*
 */
export { SITE_MODULES, ALL_SITE_MODULES, ENABLED_SITE_MODULES, getSiteModule, getSiteModuleByUrl } from './site-modules';
export type { SiteModuleConfig } from './site-modules';
