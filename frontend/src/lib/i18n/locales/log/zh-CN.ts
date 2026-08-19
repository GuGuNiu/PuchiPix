import type { TranslationDict } from "../../types";

const zhCN: TranslationDict = {
  // Safe delete
  "log.safeDelete.fileFailed": "文件删除失败 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "文件删除最终失败: {path} — {msg}",
  "log.safeDelete.dirFailed": "目录删除失败 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "目录删除最终失败: {path} — {msg}",

  // Gallery handler
  "log.galleryHandler.cancelledInQueue": "图库 #{id} 在排队等待中被取消",
  "log.galleryHandler.cancelledInScrapeQueue": "图库 #{id} 在识别排队等待中被取消",
  "log.galleryHandler.domainRateLimited": "域名 {url} 返回 {status}限流快速切换",
  "log.galleryHandler.asyncScrapeError": "图库 #{id} 异步爬取异常",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",
  "log.galleryHandler.downloadFailed": "下载失败: {msg}",
  "log.galleryHandler.downloadComplete": "下载完成: 成功 {success}, 失败 {failed}, 跳过 {skipped}",

  // SJS site
  "log.sjs.noAccount": "无可用账户将以游客模式访问可能无法看到完整内容",
  "log.sjs.cookieInjected": "账户 #{id} Cookie 已注入{count} 个",
  "log.sjs.cookieInjectionFailed": "Cookie 注入失败将尝试重新登录",
  "log.sjs.noCookieStartLogin": "无有效 Cookie开始登录流程...",
  "log.sjs.loginSuccess": "账户 #{id} 登录成功Cookie 已保存{count} 个",
  "log.sjs.loginFailed": "登录失败",
  "log.sjs.paidContent": "帖子为付费内容需购买后才能查看下载链接",
  "log.sjs.detectedDownloadLinks": "检测到 {count} 个下载链接帖子已购买",
  "log.sjs.pageNewImages": "帖子第 {page} 页: 新增图片累计 {total}",
  "log.sjs.scrapePageFailed": "爬取帖子第 {page} 页失败",
  "log.sjs.learnPersonFailed": "learnPerson 失败",
  "log.sjs.listPageNoResults": "列表页第 {page} 页无结果结束",
  "log.sjs.listPageNewResults": "列表页第 {page} 页: 新增 {count} 个结果累计 {total}",
  "log.sjs.listPageNoNext": "列表页无下一页链接结束",
  "log.sjs.navNextFailed": "导航到下一页失败",
  "log.sjs.gotFormhash": "获取 formhash: {value}",
  "log.sjs.httpLoginSuccess": "HTTP 登录成功{count} 个 Cookie",
  "log.sjs.signLink": "签到链接: {href}",
  "log.sjs.postNotPurchased": "帖子 \"{title}\" 未购买开始购买流程...",
  "log.sjs.buyFormParams": "购买表单参数: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "开始签到: {username}",

  // Site registry
  "log.siteRegistry.providerNotFound": "未找到站点 \"{id}\" 的 Provider 实现",

  // Site account management
  "log.siteAccountManager.cookieSaved": "账户 #{id} Cookie 已保存{count} 个",

  // ExHentai
  "log.exhentai.scrapePageFailed": "爬取图库第 {page} 页失败",
  "log.exhentai.pageNewLinks": "图库第 {page} 页: 收集 {count} 个图片页链接累计 {total}",
  "log.exhentai.batchFailed": "批量获取图片 URL 失败 (batch {batch})",
  "log.exhentai.listPageNoResults": "列表页第 {page} 页无结果结束",
  "log.exhentai.listPageNewResults": "列表页第 {page} 页: 新增 {count} 个结果累计 {total}",
  "log.exhentai.listPageNoNext": "列表页无下一页链接结束",
  "log.exhentai.navNextFailed": "导航到下一页失败",

  // Aimeizizi
  "log.aimeizizi.learnPersonFailed": "learnPerson 失败",
  "log.aimeizizi.blockedSearchResult": "屏蔽搜索结果: \"{title}...\"原因: {reason}",
  "log.aimeizizi.domainRateLimited": "第 {page} 页遭遇 {status}标记域名 {domain} 为限流",
  "log.aimeizizi.domainSwitchSuccess": "第 {page} 页切换到域名 {domain} 成功",
  "log.aimeizizi.domainSwitchFailed": "第 {page} 页域名 {domain} 失败: {msg}",
  "log.aimeizizi.scrapePageFailed": "爬取第 {page} 页失败 (域名 {domain})",
  "log.aimeizizi.blockedGalleryScrape": "屏蔽图库爬取: \"{title}...\"原因: {reason}",
  "log.aimeizizi.gameCharDetected": "识别到游戏角色: {chars}",
  "log.aimeizizi.listPageFailed": "爬取列表页第 {page} 页失败",

  // Xsnvshen
  "log.xsnvshen.ageVerifySuccess": "防沉迷验证通过 (域名: {domain})",
  "log.xsnvshen.ageVerifyFailed": "防沉迷验证失败 (域名: {domain}, 状态: {status})",
  "log.xsnvshen.ageVerifyError": "防沉迷验证异常 (域名: {domain}, 错误: {error})",
  "log.xsnvshen.httpFetchError": "HTTP 请求失败 (域名: {domain}, 错误: {error})",
  "log.xsnvshen.blockedSearchResult": "屏蔽搜索结果: \"{title}...\"原因: {reason}",
  "log.xsnvshen.blockedGalleryScrape": "屏蔽图库爬取: \"{title}...\"原因: {reason}",
  "log.xsnvshen.gameCharDetected": "识别到游戏角色: {chars}",
  "log.xsnvshen.learnPersonFailed": "learnPerson 失败",
  "log.xsnvshen.listPageFailed": "爬取列表页第 {page} 页失败",

  // Scrape
  "log.scrape.capturedM3u8": "{url} — 捕获到 {count} 个 M3U8 URL: {urls}",

  // Protagonist service
  "log.protagonist.personCacheInitFailed": "Person 缓存初始化失败",

  // Search engine
  "log.search.batchComplete": "批量爬取完成成功 {ok}失败 {fail}",
  "log.search.terminated": "搜索任务异常终止: {msg}",
  "log.search.batchTerminated": "批量搜索任务异常终止: {msg}",

  // Task creator
  "log.taskCreator.downloadStartFailed": "下载任务 #{taskId} 启动失败: {msg}",

  // Parallel downloader
  "log.parallelDL.writeFailed": "[ParallelDL] 写入失败: {msg}",
  "log.parallelDL.requestFailed": "[ParallelDL] 请求失败: {msg}",

  // Download manager
  "log.downloadManager.segmentFailed": "  分片 #{idx}: {msg}",
  "log.downloadManager.incomplete": "下载不完整{failedCount} 个分片下载失败共 {totalSegments} 个分片\n{details}",

  // Task queue manager
  "log.taskQueue.slotAllocated": "槽位已分配: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "槽位已释放: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "识别槽位已分配: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "识别槽位已释放: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "排队任务已取消: {type}-{id}",
  "log.taskQueue.scrapingCancel": "排队识别任务已取消: {type}-{id}",
  "log.taskQueue.pendingGranted": "排队任务获得槽位: {key} (运行中: 普通={normal}/{maxNormal}, 嗅探={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "排队识别任务获得槽位: {key} (识别中: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "槽位已满任务排队等待: {key} (队列位置 {position})",
  "log.taskQueue.scrapingFull": "识别槽位已满任务排队等待: {key} (队列位置 {position})",
  "log.taskQueue.configLoaded": "配置已加载: 普通任务上限={maxConcurrent}, 识别中上限={maxScraping}, 嗅探任务上限={maxSniff}, TS分片并发={tsSegment}, 图库图片并发={galleryImage}",
  "log.taskQueue.configUpdated": "配置已更新: 普通任务上限={maxConcurrent}, 识别中上限={maxScraping}, 嗅探任务上限={maxSniff}, TS分片并发={tsSegment}, 图库图片并发={galleryImage}",
  "log.taskQueue.configSeeded": "默认配置已预写入数据库: {keys}",
  "log.taskQueue.listenersRegistered": "EventBus 终态监听器已注册",
  "log.taskQueue.resetWarn": "计数器已强制重置",
"log.taskQueue.startupRecovery": "启动恢复已重新排队 {count} 个任务",
  "log.taskQueue.configLoadFailed": "加载配置失败使用默认值: {error}",

  // Server lifecycle
  "log.server.taskStateReset": "启动时任务状态重置完成",
  "log.server.downloadManagerInit": "下载管理器已初始化",
  "log.server.eventBusBridgeInit": "EventBus 桥接已初始化",
  "log.server.ouoOrchestratorStart": "OUO 编排器已启动",

  // Task state reset
  "log.taskStateReset.started": "开始重置运行中任务状态...",
  "log.taskStateReset.cleanupSlots": "清理残留槽位: 普通={normal}, 嗅探={sniff}, 识别={scraping}",
  "log.taskStateReset.completed": "重置完成视频 {videoTasks}图库 {galleries}图片 {galleryImages}视频 {galleryVideos}嗅探 {sniffTasks}ZIP信息 {galleryDownloadInfos}共 {total} 个任务已重置为待处理状态",
  "log.taskStateReset.noop": "未发现运行中任务无需重置",
  "log.taskStateReset.suspended": "服务重启，任务已挂起",

  // Preset data seed
  "log.seed.presetDataSeeded": "预置数据已写入数据库: 用户偏好 {prefs} 条, 屏蔽词 {blocklists} 条",

  // DAG Orchestrator
  "log.dagOrchestrator.initComplete": "[DagOrchestrator] 初始化完成",
  "log.dagOrchestrator.dagCompleted": "[DagOrchestrator] DAG {dagId} 全部完成",
  "log.dagOrchestrator.dagEndedWithFailure": "[DagOrchestrator] DAG {dagId} 已结束（有失败/取消）",
  "log.dagOrchestrator.updateGalleryStatusFailed": "[DagOrchestrator] 更新图库 {galleryId} 状态失败",
  "log.dagOrchestrator.dagCancelled": "[DagOrchestrator] DAG {dagId} 已取消",
  "log.dagOrchestrator.dagNotFoundCannotResume": "[DagOrchestrator] DAG {dagId} 未找到无法恢复",
  "log.dagOrchestrator.resumeNodeFailedQueueFull": "[DagOrchestrator] 恢复节点 {nodeId} 提交失败队列满保持 READY 状态",
  "log.dagOrchestrator.dagResumeComplete": "[DagOrchestrator] DAG {dagId} 恢复完成: {resumedCount}/{totalCount} 个节点已重新提交",
  "log.dagOrchestrator.restoreDag": "[DagOrchestrator] 恢复 DAG {dagId} ({nodeCount} 个节点)",
  "log.dagOrchestrator.restartRecoveryComplete": "[DagOrchestrator] 重启恢复完成: {pausedCount} 个节点已挂起等待用户手动恢复",
  "log.dagOrchestrator.retryNodes": "[DagOrchestrator] DAG {dagId} 重试 {nodeCount} 个节点",
  "log.dagOrchestrator.dagSubmitted": "[DagOrchestrator] DAG {dagId} 已提交（{nodeCount} 个节点）",
  "log.dagOrchestrator.nodeSubmitFailedQueueFull": "[DagOrchestrator] 节点 {nodeId} 提交失败队列满保持 READY 状态等待重试",
  "log.dagOrchestrator.nodeNotFoundCannotTransition": "[DagOrchestrator] 节点 {nodeId} 未找到，无法转换状态",
  "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] 清除图库 {galleryId} 错误消息失败",
  "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} 已暂停 ({pausedCount} 个节点)",
  "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} 未找到无法暂停",

  // DAG Init
  "log.dagSystem.alreadyInitialized": "[DagSystem] 已初始化，跳过",
  "log.dagSystem.initComplete": "[DagSystem] 初始化完成 (功能开关: {status})",
  "log.dagSystem.initFailed": "[DagSystem] 初始化失败",
  "log.dagSystem.timerStarted": "[DagSystem] 定时任务已启动",
  "log.dagSystem.stopped": "[DagSystem] 已停止",
  "log.dagSystem.gracefulShutdownComplete": "[DagSystem] 优雅关闭完成",

  // Orchestrator Base
  "log.orchestratorBase.alreadyRunning": "[{name}] 已在运行，跳过",
  "log.orchestratorBase.started": "[{name}] 编排器已启动",
  "log.orchestratorBase.stopping": "[{name}] 编排器停止中...",
  "log.orchestratorBase.waitingForTask": "[{name}] 等待当前任务 #{taskId} 完成...",
  "log.orchestratorBase.stopped": "[{name}] 编排器已停止",
  "log.orchestratorBase.paused": "[{name}] 编排器已暂停",
  "log.orchestratorBase.resumed": "[{name}] 编排器已恢复",
  "log.orchestratorBase.taskCancelled": "[{name}] 任务已取消 ID={id}",
  "log.orchestratorBase.queueCleared": "[{name}] 队列已清空（移除 {count} 个待处理任务）",
  "log.orchestratorBase.taskDependencyFailed": "[{name}] 任务因依赖失败取消: ID={id}",
  "log.orchestratorBase.rateLimitWaiting": "[{name}] 限流冷却中，等待 {waitMs}s 后继续...",
  "log.orchestratorBase.rateLimitResume": "[{name}] 限流冷却结束，继续处理队列",
  "log.orchestratorBase.queueSummary": "[{name}] 队列状态（共处理 {total} 任务，成功 {success}，失败 {failed}）",
  "log.orchestratorBase.startProcessing": "[{name}] 开始处理: ID={taskId} (第{count} 个任务)",
  "log.orchestratorBase.taskSuccess": "[{name}] 任务成功: ID={taskId}",
  "log.orchestratorBase.taskFailedRetry": "[{name}] 任务失败，将重试（第 {retryCount} 次）: ID={taskId}, 等待 {waitSec}s",
  "log.orchestratorBase.taskFailedExhausted": "[{name}] 任务失败（已耗尽重试）: ID={taskId}: {errorMsg}",
  "log.orchestratorBase.queueFullRejected": "[{name}] 队列已满（{pending}/{max}），拒绝入队: ID={id}（累计拒绝 {rejected} 次）",
  "log.orchestratorBase.taskEnqueued": "[{name}] 任务入队: ID={id}, 位置 {position}（队列 {current}/{max}）",
  "log.orchestratorBase.processingLoopError": "[{name}] 处理循环异常:",
  "log.orchestratorBase.taskFailedDefault": "任务失败",
  "log.orchestratorBase.taskExceptionRetry": "[{name}] 任务异常，将重试（第 {retryCount} 次）: ID={taskId}, 等待 {waitSec}s",
  "log.orchestratorBase.taskExceptionExhausted": "[{name}] 任务异常（已耗尽重试）: ID={taskId}: {errorMsg}",
  "log.orchestratorBase.ipRateLimited": "IP 限流",
  "log.orchestratorBase.rateLimitTriggered": "[{name}] 限流触发: ID={id}, 冷却 {minutes} 分钟",
  "log.orchestratorBase.cooldownResumeRequeue": "[{name}] 冷却结束，任务重新入队: ID={id} (重试第{retryCount} 次)",
  "log.orchestratorBase.ipRateLimitExhausted": "IP 限流（已耗尽重试）",
  "log.orchestratorBase.cooldownEndExhausted": "[{name}] 冷却结束但已耗尽重试: ID={id}",

  // DAG Config
  "log.dagConfig.schedulerToggle": "[DagConfig] DAG 调度器{status}",
  "log.dagConfig.taskTypesUpdated": "[DagConfig] DAG 任务类型更新: [{value}]",
  "log.dagConfig.configLoadComplete": "[DagConfig] 配置加载完成: enabled={enabled}, taskTypes=[{taskTypes}]",
  "log.dagConfig.configLoadFailed": "[DagConfig] 配置加载失败:",
  "log.dagConfig.usingDefaultConfig": "[DagConfig] 使用默认配置: enabled=true (加载失败后的安全降级)",
} satisfies TranslationDict;

/** Log module translation key union type */
export type LogTranslationKeys = keyof typeof zhCN;

export default zhCN;
