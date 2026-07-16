import type { TranslationDict } from "../../types";

// API error messages — American English
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

  "api.tasks.noM3u8Extracted": "Unable to extract M3U8 link from page",

  "api.blocklist.addFailed": "Add failed",

  "api.common.internalError": "Internal server error",
  "api.common.missingParams": "Missing required parameters: {params}",
};

export default enUS;
