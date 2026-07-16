import type { TranslationDict } from "../../types";

// 日誌訊息模板 — 繁體中文
const zhTW: TranslationDict = {
  "log.safeDelete.fileFailed": "檔案刪除失敗 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "檔案刪除最終失敗: {path} — {msg}",
  "log.safeDelete.dirFailed": "目錄刪除失敗 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "目錄刪除最終失敗: {path} — {msg}",

  "log.galleryHandler.cancelledInQueue": "圖庫 #{id} 在排隊等待中被取消",
  "log.galleryHandler.cancelledInScrapeQueue": "圖庫 #{id} 在識別排隊等待中被取消",
  "log.galleryHandler.domainRateLimited": "域名 {url} 返回 {status}（限流），快速切換",
  "log.galleryHandler.asyncScrapeError": "圖庫 #{id} 非同步爬取異常",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",

  "log.sjs.noAccount": "無可用帳戶，將以遊客模式存取（可能無法看到完整內容）",
  "log.sjs.cookieInjected": "帳戶 #{id} Cookie 已注入（{count} 個）",
  "log.sjs.cookieInjectionFailed": "Cookie 注入失敗，將嘗試重新登入",
  "log.sjs.noCookieStartLogin": "無有效 Cookie，開始登入流程...",
  "log.sjs.loginSuccess": "帳戶 #{id} 登入成功，Cookie 已儲存（{count} 個）",
  "log.sjs.loginFailed": "登入失敗",
  "log.sjs.paidContent": "帖子為付費內容，需購買後才能檢視下載連結",
  "log.sjs.detectedDownloadLinks": "偵測到 {count} 個下載連結（帖子已購買）",
  "log.sjs.pageNewImages": "帖子第 {page} 頁: 新增圖片（累計 {total}）",
  "log.sjs.scrapePageFailed": "爬取帖子第 {page} 頁失敗",
  "log.sjs.learnPersonFailed": "learnPerson 失敗",
  "log.sjs.listPageNoResults": "列表頁第 {page} 頁無結果，結束",
  "log.sjs.listPageNewResults": "列表頁第 {page} 頁: 新增 {count} 個結果（累計 {total}）",
  "log.sjs.listPageNoNext": "列表頁無下一頁連結，結束",
  "log.sjs.navNextFailed": "導航到下一頁失敗",
  "log.sjs.gotFormhash": "取得 formhash: {value}",
  "log.sjs.httpLoginSuccess": "HTTP 登入成功（{count} 個 Cookie）",
  "log.sjs.signLink": "簽到連結: {href}",
  "log.sjs.postNotPurchased": "帖子 \"{title}\" 未購買，開始購買流程...",
  "log.sjs.buyFormParams": "購買表單參數: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "開始簽到: {username}",

  "log.siteRegistry.providerNotFound": "未找到站點 \"{id}\" 的 Provider 實作",

  "log.siteAccountManager.cookieSaved": "帳戶 #{id} Cookie 已儲存（{count} 個）",

  "log.exhentai.scrapePageFailed": "爬取圖庫第 {page} 頁失敗",
  "log.exhentai.pageNewLinks": "圖庫第 {page} 頁: 收集 {count} 個圖片頁連結（累計 {total}）",
  "log.exhentai.batchFailed": "批次取得圖片 URL 失敗 (batch {batch})",
  "log.exhentai.listPageNoResults": "列表頁第 {page} 頁無結果，結束",
  "log.exhentai.listPageNewResults": "列表頁第 {page} 頁: 新增 {count} 個結果（累計 {total}）",
  "log.exhentai.listPageNoNext": "列表頁無下一頁連結，結束",
  "log.exhentai.navNextFailed": "導航到下一頁失敗",

  "log.aimeizizi.learnPersonFailed": "learnPerson 失敗",
  "log.aimeizizi.blockedSearchResult": "屏蔽搜尋結果: \"{title}...\"，原因: {reason}",
  "log.aimeizizi.domainRateLimited": "第 {page} 頁遭遇 {status}，標記域名 {domain} 為限流",
  "log.aimeizizi.domainSwitchSuccess": "第 {page} 頁切換到域名 {domain} 成功",
  "log.aimeizizi.domainSwitchFailed": "第 {page} 頁域名 {domain} 失敗: {msg}",
  "log.aimeizizi.scrapePageFailed": "爬取第 {page} 頁失敗 (域名 {domain})",
  "log.aimeizizi.blockedGalleryScrape": "屏蔽圖庫爬取: \"{title}...\"，原因: {reason}",
  "log.aimeizizi.gameCharDetected": "識別到遊戲角色: {chars}",
  "log.aimeizizi.listPageFailed": "爬取列表頁第 {page} 頁失敗",

  "log.scrape.capturedM3u8": "{url} — 擷取到 {count} 個 M3U8 URL: {urls}",

  "log.protagonist.personCacheInitFailed": "Person 快取初始化失敗",

  "log.search.batchComplete": "批次爬取完成！成功 {ok}，失敗 {fail}",

  // 任務隊列管理器
  "log.taskQueue.slotAllocated": "槽位已分配: {key} (執行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "槽位已釋放: {key} (執行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "識別槽位已分配: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "識別槽位已釋放: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "排隊任務已取消: {type}-{id}",
  "log.taskQueue.scrapingCancel": "排隊識別任務已取消: {type}-{id}",
  "log.taskQueue.pendingGranted": "排隊任務獲得槽位: {key} (執行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "排隊識別任務獲得槽位: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "槽位已滿，任務排隊等待: {key} (佇列位置 {position})",
  "log.taskQueue.scrapingFull": "識別槽位已滿，任務排隊等待: {key} (佇列位置 {position})",
  "log.taskQueue.configLoaded": "配置已載入: 普通任務上限={maxConcurrent}, 識別中上限={maxScraping}, 嗅探任務上限={maxSniff}, TS分片並行={tsSegment}, 圖庫圖片並行={galleryImage}",
  "log.taskQueue.configUpdated": "配置已更新: 普通任務上限={maxConcurrent}, 識別中上限={maxScraping}, 嗅探任務上限={maxSniff}, TS分片並行={tsSegment}, 圖庫圖片並行={galleryImage}",
  "log.taskQueue.configSeeded": "預設配置已預寫入資料庫: {keys}",
  "log.taskQueue.listenersRegistered": "EventBus 終態監聽器已註冊",
  "log.taskQueue.resetWarn": "計數器已強制重置",
  "log.taskQueue.configLoadFailed": "載入配置失敗，使用預設值: {error}",

  // 服務端生命週期
  "log.server.taskStateReset": "啟動時任務狀態重置完成",
  "log.server.downloadManagerInit": "下載管理器已初始化",
  "log.server.eventBusBridgeInit": "EventBus 橋接已初始化",
  "log.server.ouoOrchestratorStart": "OUO 編排器已啟動",

  // 任務狀態重置
  "log.taskStateReset.started": "開始重置執行中任務狀態...",
  "log.taskStateReset.cleanupSlots": "清理殘留槽位: 普通={normal}, 嗅探={sniff}, 識別={scraping}",
  "log.taskStateReset.completed": "重置完成：影片 {videoTasks}, 圖庫 {galleries}, 圖片 {galleryImages}, 影片 {galleryVideos}, 嗅探 {sniffTasks}, ZIP資訊 {galleryDownloadInfos}, 共 {total} 個任務已重置為待處理狀態",
  "log.taskStateReset.noop": "未發現執行中任務，無需重置",
};

export default zhTW;
