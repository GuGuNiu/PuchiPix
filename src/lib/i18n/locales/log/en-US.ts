import type { TranslationDict } from "../../types";

// Log message templates — American English
const enUS: TranslationDict = {
  "log.safeDelete.fileFailed": "File deletion failed ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "File deletion ultimately failed: {path} — {msg}",
  "log.safeDelete.dirFailed": "Directory deletion failed ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "Directory deletion ultimately failed: {path} — {msg}",

  "log.galleryHandler.cancelledInQueue": "Gallery #{id} cancelled while waiting in queue",
  "log.galleryHandler.cancelledInScrapeQueue": "Gallery #{id} cancelled while waiting in scrape queue",
  "log.galleryHandler.domainRateLimited": "Domain {url} returned {status} (rate limited), fast switching",
  "log.galleryHandler.asyncScrapeError": "Gallery #{id} async scrape error",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",

  "log.sjs.noAccount": "No available account, accessing as guest (full content may not be visible)",
  "log.sjs.cookieInjected": "Account #{id} Cookie injected ({count} items)",
  "log.sjs.cookieInjectionFailed": "Cookie injection failed, will try re-login",
  "log.sjs.noCookieStartLogin": "No valid Cookie, starting login flow...",
  "log.sjs.loginSuccess": "Account #{id} login successful, Cookie saved ({count} items)",
  "log.sjs.loginFailed": "Login failed",
  "log.sjs.paidContent": "Post is paid content, must purchase to view download links",
  "log.sjs.detectedDownloadLinks": "Detected {count} download links (post purchased)",
  "log.sjs.pageNewImages": "Post page {page}: new images (total {total})",
  "log.sjs.scrapePageFailed": "Failed to scrape post page {page}",
  "log.sjs.learnPersonFailed": "learnPerson failed",
  "log.sjs.listPageNoResults": "List page {page}: no results, ending",
  "log.sjs.listPageNewResults": "List page {page}: {count} new results (total {total})",
  "log.sjs.listPageNoNext": "No next page link on list page, ending",
  "log.sjs.navNextFailed": "Navigation to next page failed",
  "log.sjs.gotFormhash": "Got formhash: {value}",
  "log.sjs.httpLoginSuccess": "HTTP login successful ({count} Cookies)",
  "log.sjs.signLink": "Sign-in link: {href}",
  "log.sjs.postNotPurchased": "Post \"{title}\" not purchased, starting purchase flow...",
  "log.sjs.buyFormParams": "Buy form params: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "Starting sign-in: {username}",

  "log.siteRegistry.providerNotFound": "No Provider implementation found for site \"{id}\"",

  "log.siteAccountManager.cookieSaved": "Account #{id} Cookie saved ({count} items)",

  "log.exhentai.scrapePageFailed": "Failed to scrape gallery page {page}",
  "log.exhentai.pageNewLinks": "Gallery page {page}: collected {count} image page links (total {total})",
  "log.exhentai.batchFailed": "Batch image URL fetch failed (batch {batch})",
  "log.exhentai.listPageNoResults": "List page {page}: no results, ending",
  "log.exhentai.listPageNewResults": "List page {page}: {count} new results (total {total})",
  "log.exhentai.listPageNoNext": "No next page link on list page, ending",
  "log.exhentai.navNextFailed": "Navigation to next page failed",

  "log.aimeizizi.learnPersonFailed": "learnPerson failed",
  "log.aimeizizi.blockedSearchResult": "Blocked search result: \"{title}...\", reason: {reason}",
  "log.aimeizizi.domainRateLimited": "Page {page} hit {status}, marking domain {domain} as rate-limited",
  "log.aimeizizi.domainSwitchSuccess": "Page {page} switched to domain {domain} successfully",
  "log.aimeizizi.domainSwitchFailed": "Page {page} domain {domain} failed: {msg}",
  "log.aimeizizi.scrapePageFailed": "Failed to scrape page {page} (domain {domain})",
  "log.aimeizizi.blockedGalleryScrape": "Blocked gallery scrape: \"{title}...\", reason: {reason}",
  "log.aimeizizi.gameCharDetected": "Detected game characters: {chars}",
  "log.aimeizizi.listPageFailed": "Failed to scrape list page {page}",

  "log.scrape.capturedM3u8": "{url} — captured {count} M3U8 URLs: {urls}",

  "log.protagonist.personCacheInitFailed": "Person cache initialization failed",

  "log.search.batchComplete": "Batch scrape complete! {ok} succeeded, {fail} failed",

  // Task Queue Manager
  "log.taskQueue.slotAllocated": "Slot allocated: {key} (running: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "Slot released: {key} (running: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "Scraping slot allocated: {key} (scraping: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "Scraping slot released: {key} (scraping: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "Pending task cancelled: {type}-{id}",
  "log.taskQueue.scrapingCancel": "Pending scraping task cancelled: {type}-{id}",
  "log.taskQueue.pendingGranted": "Pending task granted slot: {key} (running: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "Pending scraping task granted slot: {key} (scraping: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "Slots full, task queued: {key} (queue position {position})",
  "log.taskQueue.scrapingFull": "Scraping slots full, task queued: {key} (queue position {position})",
  "log.taskQueue.configLoaded": "Config loaded: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.configUpdated": "Config updated: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.listenersRegistered": "EventBus terminal listeners registered",
  "log.taskQueue.resetWarn": "Counters force-reset",
  "log.taskQueue.configLoadFailed": "Failed to load config, using defaults: {error}",

  // Server Lifecycle
  "log.server.taskStateReset": "Startup task state reset complete",
  "log.server.downloadManagerInit": "Download manager initialized",
  "log.server.eventBusBridgeInit": "EventBus bridge initialized",
  "log.server.ouoOrchestratorStart": "OUO orchestrator started",

  // Task State Reset
  "log.taskStateReset.started": "Starting running task state reset...",
  "log.taskStateReset.cleanupSlots": "Cleaning stale slots: normal={normal}, sniff={sniff}, scraping={scraping}",
  "log.taskStateReset.completed": "Reset complete: video {videoTasks}, galleries {galleries}, images {galleryImages}, videos {galleryVideos}, sniff {sniffTasks}, ZIP info {galleryDownloadInfos}, total {total} tasks reset to pending",
  "log.taskStateReset.noop": "No running tasks found, nothing to reset",
};

export default enUS;
