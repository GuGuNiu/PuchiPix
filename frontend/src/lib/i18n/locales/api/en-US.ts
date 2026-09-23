import type { TranslationDict } from "../../types";

// API error messages — en-US
const enUS: TranslationDict = {
  "api.validation.maxConcurrentTasks": "Max concurrent tasks must be between 1 and 50",
  "api.validation.maxSniffConcurrent": "Max sniff concurrency must be between 1 and 10",
  "api.validation.maxScrapingSlots": "Max scraping slots must be between 1 and 50",
  "api.validation.tsSegmentConcurrent": "TS segment concurrency must be between 1 and 200",
  "api.validation.galleryImageConcurrent": "Gallery image concurrency must be between 1 and 50",

  "api.sjs.missingAction": "Missing action parameter",
  "api.sjs.signMissingAccountId": "Sign-in requires accountId parameter",
  "api.sjs.buyMissingAccountId": "Buying post requires accountId parameter",
  "api.sjs.buyMissingTid": "Buying post requires tid parameter (post ID)",
  "api.sjs.loginMissingAccountId": "Login requires accountId parameter",

  // SJS Shelf
  "api.sjsShelf.noUrls": "Please provide a URL list",
  "api.sjsShelf.emptyUrl": "Empty URL",
  "api.sjsShelf.invalidSjsUrl": "Not a valid SJS URL",
  "api.sjsShelf.missingId": "Missing id parameter",
  "api.sjsShelf.invalidId": "Invalid id",
  "api.sjsShelf.notFound": "Bookmark not found",
  "api.sjsShelf.refreshFailed": "Failed to refresh metadata",
  "api.sjsShelf.unknownAction": "Unknown action",

  "api.search.missingJobId": "Please provide jobId",
  "api.search.batchScrapeStarted": "Batch scrape started",
  "api.search.missingPageUrl": "Please provide pageUrl",
  "api.search.videoNotFound": "Video item not found",
  "api.search.missingKeyword": "Please provide search keywords",
  "api.search.missingVideoTitle": "Please provide video title",

  "api.protagonist.galleryNotFound": "No galleries found for this character",
  "api.protagonist.fetchFailed": "Failed to fetch character info",

  "api.ouo.missingParams": "Missing required parameters: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Missing required parameter: galleryId",

  "api.gallery.notFound": "Gallery not found",
  "api.gallery.noProviderMatch": "No matching site provider found, cannot re-scrape",
  "api.gallery.rescrapeStarted": "Gallery re-scrape started",
  "api.gallery.retryFailedStarted": "Failed file retry started",
  "api.gallery.downloadStarted": "Gallery download started",
  "api.gallery.noZipInfo": "This gallery has no ZIP download info",
  "api.gallery.noDownloadUrl": "No download URL available, please provide a mirror link manually",
  "api.gallery.invalidSource": "Only ouo.io source supports orchestrator enqueue, current source is {source}",
  "api.gallery.noZipData": "No ZIP download info",
  "api.gallery.noProvider": "No matching site provider found",
  "api.gallery.alreadyScraping": "This gallery is being scraped by another task, please retry later",
  "api.gallery.pageNotFound": "Page not found (404)",
  "api.gallery.pageNotFoundSkipped": "Page not found (404), skipped",
  "api.gallery.identifying": "Gallery is being identified, please wait for identification to complete before downloading",
  "api.gallery.scrapeComplete": "Gallery scraping complete, download started asynchronously",
  "api.gallery.batchMissingUrls": "urls parameter must be a non-empty array",
  "api.gallery.batchEmptyUrl": "Empty URL",
  "api.gallery.noProviderForRescrape": "No matching gallery provider found, cannot re-scrape",

  "api.tasks.noM3u8Extracted": "Unable to extract M3U8 link from page",

  "api.blocklist.addFailed": "Add failed",

// Logs
  "api.logs.systemReady": "System ready, waiting for tasks...",
  "api.logs.taskNumber": "Task #{id}",
  "api.logs.fetchFailed": "Failed to fetch logs",

  // Gallery (supplement)
  "api.gallery.unsupportedScrape": "Site {site} does not support gallery scraping",
  "api.gallery.allDomainsFailed": "All domains failed to scrape",

  // Tasks (supplement)
  "api.tasks.multipleM3u8Detected": "Detected {count} M3U8 addresses, please select",
  "api.tasks.unsupportedListScrape": "Provider does not support listing page scraping",

  // Common
  "api.characterDb.syncRunning": "Sync task is already running",
  "api.common.internalError": "Internal server error",
  "api.common.missingParams": "Missing required parameters: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} not found",
  "api.dag.invalidAction": "Invalid action: {action}",
  "api.dag.schedulerRequired": "DAG control requires scheduler (Phase 3)",

  // Go backend — common
  "api.common.databaseUnavailable": "Database not available",
  "api.common.missingBody": "Request body is required",
  "api.common.invalidJson": "Invalid JSON body",
  "api.common.endpointNotFound": "Endpoint not found",
  "api.common.methodNotAllowed": "Method not allowed",
  "api.common.streamingNotSupported": "Streaming not supported",
  "api.common.invalidId": "Invalid ID",
  "api.common.keyRequired": "Key is required",

  // Go backend — accounts
  "api.accounts.queryFailed": "Failed to query accounts",
  "api.accounts.missingFields": "siteId, username, and password are required",
  "api.accounts.createFailed": "Failed to create account",
  "api.accounts.updateFailed": "Failed to update account",
  "api.accounts.deleteFailed": "Failed to delete account",

  // Go backend — persons
  "api.persons.queryFailed": "Failed to query persons",
  "api.persons.missingName": "Name is required",
  "api.persons.createFailed": "Failed to create person",
  "api.persons.updateFailed": "Failed to update person",
  "api.persons.deleteFailed": "Failed to delete person",

  // Go backend — blocklist
  "api.blocklist.queryFailed": "Failed to query blocklist",
  "api.blocklist.missingFields": "fieldType and keyword are required",
  "api.blocklist.createFailed": "Failed to create blocklist rule",
  "api.blocklist.updateFailed": "Failed to update blocklist rule",
  "api.blocklist.deleteFailed": "Failed to delete blocklist rule",

  // Go backend — config
  "api.config.queryFailed": "Failed to query config",
  "api.config.updateFailed": "Failed to update config",

  // Go backend — preferences
  "api.preferences.queryFailed": "Failed to query preferences",
  "api.preferences.updateFailed": "Failed to update preference",

  // Go backend — tasks
  "api.tasks.queryFailed": "Failed to query tasks",
  "api.tasks.missingUrl": "URL is required",
  "api.tasks.createFailed": "Failed to create task",
  "api.tasks.invalidId": "Invalid task ID",
  "api.tasks.notFound": "Task not found",
  "api.tasks.schedulerRequired": "Task actions require scheduler (Phase 3)",

  // Go backend — gallery
  "api.gallery.queryFailed": "Failed to query galleries",
  "api.gallery.invalidId": "Invalid gallery ID",
  "api.gallery.queryImagesFailed": "Failed to query images",

  // Go backend — history
  "api.history.queryFailed": "Failed to query history",

  // Go backend — SJS shelf (supplement)
  "api.sjsShelf.queryFailed": "Failed to query SJS bookmarks",
  "api.sjsShelf.missingUrlAndThreadId": "URL and threadId are required",
  "api.sjsShelf.createFailed": "Failed to create bookmark",
  "api.sjsShelf.deleteFailed": "Failed to delete bookmark",
  "api.sjsShelf.missingUrlParam": "URL parameter is required",
  "api.sjsShelf.missingGalleryId": "galleryId is required",
  "api.characterDb.failed": "Character query failed",
  "api.characterDb.missingName": "Name parameter is required",
  "api.ouo.failed": "OUO resolution failed",
  "api.ouo.missingUrl": "URL is required",
  "api.ouo.notAvailable": "OUO orchestrator not available",
  "api.proxy.failed": "Proxy request failed",
  "api.proxy.invalidUrl": "Invalid URL",
  "api.proxy.missingUrl": "URL is required",
  "api.scrape.failed": "Scrape failed",
  "api.scrape.missingUrl": "URL is required",
  "api.scrape.noProvider": "No provider found for this URL",
  "api.scrape.notAvailable": "Scraping is not yet available",
  "api.scrape.notSupported": "Provider does not support gallery scraping",
  "api.search.failed": "Search failed",
  "api.search.missingKeywords": "Keywords are required",
  "api.searchBatch.failed": "Batch search failed",
  "api.searchBatch.missingKeywords": "Keywords array is required",
  "api.sjs.buyHandled": "Buy handled by SJS provider",
  "api.sjs.checkinHandled": "Checkin handled by SJS provider",
  "api.sjs.hideHandled": "Hide handled by SJS provider",
  "api.sjs.notAvailable": "SJS provider not available",
  "api.slots.invalidMax": "Invalid slot max value",
  "api.slots.missingSlotType": "Missing slotType parameter",
  "api.slots.slotTypeNotFound": "Slot type not found",
  "api.sniff.createFailed": "Failed to create sniff task",
  "api.sniff.deleteFailed": "Failed to delete sniff task",
  "api.sniff.missingId": "Missing sniff task ID",
  "api.sniff.missingUrl": "URL is required",
  "api.sniff.queryFailed": "Failed to query sniff tasks",
  "api.tasks.deleteFailed": "Failed to delete task",
  "api.tasks.pauseFailed": "Failed to pause task",
  "api.tasks.resumeFailed": "Failed to resume task",
  "api.tasks.retryFailed": "Failed to retry task",
  "api.tasks.startFailed": "Failed to start task",
  "api.tasks.unknownAction": "Unknown action",
};

export default enUS;
