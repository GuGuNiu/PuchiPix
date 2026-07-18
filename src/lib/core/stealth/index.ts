export {
  USER_AGENTS,
  BROWSER_PROFILES,
  randomUA,
  randomProfile,
  sleep,
  randomDelay,
  gaussianDelay,
  backoffDelay,
  buildStealthHeaders,
  buildPageHeaders,
  getStealthScripts,
  applyStealthToPage,
  createStealthPage,
  DEFAULT_ACCEPT_LANGUAGE,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  BATCH_DELAY_MIN,
  BATCH_DELAY_MAX,
  MAX_RETRIES,
  MAX_GALLERY_PAGES,
} from './anti-crawler';
export type { BrowserType, Platform, BrowserProfile } from './anti-crawler';

export { getSharedBrowser, closeSharedBrowser } from './browser-pool';

export { detectWaf, shouldFallbackToPlaywright } from './waf-detector';
export type { WafDetectionResult, WafBlockReason } from './waf-detector';
