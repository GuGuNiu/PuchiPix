import type { TranslationDict } from "../../types";

// 日志消息模板 — 简体中文（基准）
const zhCN: TranslationDict = {
  // 安全删除
  "log.safeDelete.fileFailed": "文件删除失败 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "文件删除最终失败: {path} — {msg}",
  "log.safeDelete.dirFailed": "目录删除失败 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "目录删除最终失败: {path} — {msg}",

  // 图库处理器
  "log.galleryHandler.cancelledInQueue": "图库 #{id} 在排队等待中被取消",
  "log.galleryHandler.cancelledInScrapeQueue": "图库 #{id} 在识别排队等待中被取消",
  "log.galleryHandler.domainRateLimited": "域名 {url} 返回 {status}（限流），快速切换",
  "log.galleryHandler.asyncScrapeError": "图库 #{id} 异步爬取异常",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",

  // SJS 站点
  "log.sjs.noAccount": "无可用账户，将以游客模式访问（可能无法看到完整内容）",
  "log.sjs.cookieInjected": "账户 #{id} Cookie 已注入（{count} 个）",
  "log.sjs.cookieInjectionFailed": "Cookie 注入失败，将尝试重新登录",
  "log.sjs.noCookieStartLogin": "无有效 Cookie，开始登录流程...",
  "log.sjs.loginSuccess": "账户 #{id} 登录成功，Cookie 已保存（{count} 个）",
  "log.sjs.loginFailed": "登录失败",
  "log.sjs.paidContent": "帖子为付费内容，需购买后才能查看下载链接",
  "log.sjs.detectedDownloadLinks": "检测到 {count} 个下载链接（帖子已购买）",
  "log.sjs.pageNewImages": "帖子第 {page} 页: 新增图片（累计 {total}）",
  "log.sjs.scrapePageFailed": "爬取帖子第 {page} 页失败",
  "log.sjs.learnPersonFailed": "learnPerson 失败",
  "log.sjs.listPageNoResults": "列表页第 {page} 页无结果，结束",
  "log.sjs.listPageNewResults": "列表页第 {page} 页: 新增 {count} 个结果（累计 {total}）",
  "log.sjs.listPageNoNext": "列表页无下一页链接，结束",
  "log.sjs.navNextFailed": "导航到下一页失败",
  "log.sjs.gotFormhash": "获取 formhash: {value}",
  "log.sjs.httpLoginSuccess": "HTTP 登录成功（{count} 个 Cookie）",
  "log.sjs.signLink": "签到链接: {href}",
  "log.sjs.postNotPurchased": "帖子 \"{title}\" 未购买，开始购买流程...",
  "log.sjs.buyFormParams": "购买表单参数: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "开始签到: {username}",

  // 站点注册
  "log.siteRegistry.providerNotFound": "未找到站点 \"{id}\" 的 Provider 实现",

  // 站点账户管理
  "log.siteAccountManager.cookieSaved": "账户 #{id} Cookie 已保存（{count} 个）",

  // ExHentai
  "log.exhentai.scrapePageFailed": "爬取图库第 {page} 页失败",
  "log.exhentai.pageNewLinks": "图库第 {page} 页: 收集 {count} 个图片页链接（累计 {total}）",
  "log.exhentai.batchFailed": "批量获取图片 URL 失败 (batch {batch})",
  "log.exhentai.listPageNoResults": "列表页第 {page} 页无结果，结束",
  "log.exhentai.listPageNewResults": "列表页第 {page} 页: 新增 {count} 个结果（累计 {total}）",
  "log.exhentai.listPageNoNext": "列表页无下一页链接，结束",
  "log.exhentai.navNextFailed": "导航到下一页失败",

  // 爱妹子
  "log.aimeizizi.learnPersonFailed": "learnPerson 失败",
  "log.aimeizizi.blockedSearchResult": "屏蔽搜索结果: \"{title}...\"，原因: {reason}",
  "log.aimeizizi.domainRateLimited": "第 {page} 页遭遇 {status}，标记域名 {domain} 为限流",
  "log.aimeizizi.domainSwitchSuccess": "第 {page} 页切换到域名 {domain} 成功",
  "log.aimeizizi.domainSwitchFailed": "第 {page} 页域名 {domain} 失败: {msg}",
  "log.aimeizizi.scrapePageFailed": "爬取第 {page} 页失败 (域名 {domain})",
  "log.aimeizizi.blockedGalleryScrape": "屏蔽图库爬取: \"{title}...\"，原因: {reason}",
  "log.aimeizizi.gameCharDetected": "识别到游戏角色: {chars}",
  "log.aimeizizi.listPageFailed": "爬取列表页第 {page} 页失败",

  // 通用爬取
  "log.scrape.capturedM3u8": "{url} — 捕获到 {count} 个 M3U8 URL: {urls}",

  // 主角服务
  "log.protagonist.personCacheInitFailed": "Person 缓存初始化失败",

  // 搜索引擎
  "log.search.batchComplete": "批量爬取完成！成功 {ok}，失败 {fail}",

  // 任务队列管理器
  "log.taskQueue.slotAllocated": "槽位已分配: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "槽位已释放: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "识别槽位已分配: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "识别槽位已释放: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "排队任务已取消: {type}-{id}",
  "log.taskQueue.scrapingCancel": "排队识别任务已取消: {type}-{id}",
  "log.taskQueue.pendingGranted": "排队任务获得槽位: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "排队识别任务获得槽位: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "槽位已满，任务排队等待: {key} (队列位置 {position})",
  "log.taskQueue.scrapingFull": "识别槽位已满，任务排队等待: {key} (队列位置 {position})",
  "log.taskQueue.configLoaded": "配置已加载: 普通任务上限={maxConcurrent}, 识别中上限={maxScraping}, 嗅探任务上限={maxSniff}, TS分片并发={tsSegment}, 图库图片并发={galleryImage}",
  "log.taskQueue.configUpdated": "配置已更新: 普通任务上限={maxConcurrent}, 识别中上限={maxScraping}, 嗅探任务上限={maxSniff}, TS分片并发={tsSegment}, 图库图片并发={galleryImage}",
  "log.taskQueue.configSeeded": "默认配置已预写入数据库: {keys}",
  "log.taskQueue.listenersRegistered": "EventBus 终态监听器已注册",
  "log.taskQueue.resetWarn": "计数器已强制重置",
  "log.taskQueue.configLoadFailed": "加载配置失败，使用默认值: {error}",

  // 服务端生命周期
  "log.server.taskStateReset": "启动时任务状态重置完成",
  "log.server.downloadManagerInit": "下载管理器已初始化",
  "log.server.eventBusBridgeInit": "EventBus 桥接已初始化",
  "log.server.ouoOrchestratorStart": "OUO 编排器已启动",

  // 任务状态重置
  "log.taskStateReset.started": "开始重置运行中任务状态...",
  "log.taskStateReset.cleanupSlots": "清理残留槽位: 普通={normal}, 嗅探={sniff}, 识别={scraping}",
  "log.taskStateReset.completed": "重置完成：视频 {videoTasks}，图库 {galleries}，图片 {galleryImages}，视频 {galleryVideos}，嗅探 {sniffTasks}，ZIP信息 {galleryDownloadInfos}，共 {total} 个任务已重置为待处理状态",
  "log.taskStateReset.noop": "未发现运行中任务，无需重置",
};

export default zhCN;
