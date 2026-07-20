import type { TranslationDict } from "../../types";

// API 錯誤訊息 — 繁體中文
const zhTW: TranslationDict = {
  "api.validation.maxConcurrentTasks": "同時執行任務數必須在 1~50 之間",
  "api.validation.maxSniffConcurrent": "嗅探最大並行數必須在 1~10 之間",
  "api.validation.maxScrapingSlots": "識別中最大數量必須在 1~50 之間",
  "api.validation.tsSegmentConcurrent": "TS 分片並行數必須在 1~200 之間",
  "api.validation.galleryImageConcurrent": "圖庫圖片並行數必須在 1~50 之間",

  "api.sjs.missingAction": "缺少 action 參數",
  "api.sjs.signMissingAccountId": "簽到需要 accountId 參數",
  "api.sjs.buyMissingAccountId": "購買帖子需要 accountId 參數",
  "api.sjs.buyMissingTid": "購買帖子需要 tid 參數帖子 ID",
  "api.sjs.loginMissingAccountId": "登入需要 accountId 參數",

  "api.search.missingJobId": "請提供 jobId",
  "api.search.batchScrapeStarted": "批次爬取已啟動",
  "api.search.missingPageUrl": "請提供 pageUrl",
  "api.search.videoNotFound": "未找到對應的影片項",
  "api.search.missingKeyword": "請提供搜尋關鍵字",
  "api.search.missingVideoTitle": "請提供影片標題",

  "api.protagonist.galleryNotFound": "未找到該主角的圖庫",
  "api.protagonist.fetchFailed": "取得主角資訊失敗",

  "api.ouo.missingParams": "缺少必需參數: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "缺少必需參數: galleryId",

  "api.gallery.notFound": "圖庫不存在",
  "api.gallery.noProviderMatch": "無法找到匹配的站點提供者無法重新爬取",
  "api.gallery.rescrapeStarted": "圖庫重新爬取已啟動",
  "api.gallery.retryFailedStarted": "失敗檔案重試已啟動",
  "api.gallery.downloadStarted": "圖庫下載已啟動",
  "api.gallery.noZipInfo": "該圖庫無 ZIP 下載資訊",
  "api.gallery.noDownloadUrl": "無可用下載 URL請手動提供中轉站連結",
  "api.gallery.invalidSource": "僅 ouo.io 來源支援編排器入隊當前來源為 {source}",
  "api.gallery.noZipData": "無 ZIP 下載資訊",
  "api.gallery.noProvider": "未找到匹配的站點提供者",
  "api.gallery.alreadyScraping": "該圖庫正在被其他任務爬取請稍後重試",
  "api.gallery.pageNotFound": "頁面不存在 (404)",
  "api.gallery.pageNotFoundSkipped": "頁面不存在 (404)已跳過",
  "api.gallery.identifying": "圖庫正在識別中請等待識別完成後再開始下載",
  "api.gallery.scrapeComplete": "圖庫爬取完成下載已非同步啟動",
  "api.gallery.batchMissingUrls": "urls 參數必須是非空陣列",
  "api.gallery.batchEmptyUrl": "空 URL",
  "api.gallery.noProviderForRescrape": "無法匹配圖庫提供商無法重新爬取",

  "api.tasks.noM3u8Extracted": "無法從頁面提取 M3U8 連結",

  "api.blocklist.addFailed": "新增失敗",

// 日誌
  "api.logs.systemReady": "系統就緒，等待任務...",
  "api.logs.taskNumber": "任務 #{id}",
  "api.logs.fetchFailed": "日誌取得失敗",

  // 圖庫（補充）
  "api.gallery.unsupportedScrape": "站點 {site} 不支援圖庫爬取",
  "api.gallery.allDomainsFailed": "所有域名均爬取失敗",

  // 任務（補充）
  "api.tasks.multipleM3u8Detected": "偵測到 {count} 個 M3U8 位址，請選擇",
  "api.tasks.unsupportedListScrape": "Provider 不支援列表頁爬取",

  // 通用
  "api.characterDb.syncRunning": "同步任務正在執行中",
  "api.common.internalError": "伺服器內部錯誤",
  "api.common.missingParams": "缺少必需參數: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} 未找到",
  "api.dag.invalidAction": "無效操作: {action}",
};

export default zhTW;
