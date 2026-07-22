import type { TranslationDict } from "../../types";

const zhCN: TranslationDict = {
  // 任务设置校验
  "api.validation.maxConcurrentTasks": "同时运行任务数必须在 1~50 之间",
  "api.validation.maxSniffConcurrent": "嗅探最大并发数必须在 1~10 之间",
  "api.validation.maxScrapingSlots": "识别中最大数量必须在 1~50 之间",
  "api.validation.tsSegmentConcurrent": "TS 分片并发数必须在 1~200 之间",
  "api.validation.galleryImageConcurrent": "图库图片并发数必须在 1~50 之间",

  // SJS 论坛操作
  "api.sjs.missingAction": "缺少 action 参数",
  "api.sjs.signMissingAccountId": "签到需要 accountId 参数",
  "api.sjs.buyMissingAccountId": "购买帖子需要 accountId 参数",
  "api.sjs.buyMissingTid": "购买帖子需要 tid 参数帖子 ID",
  "api.sjs.loginMissingAccountId": "登录需要 accountId 参数",

  // SJS 收藏架
  "api.sjsShelf.noUrls": "请提供 URL 列表",
  "api.sjsShelf.emptyUrl": "空 URL",
  "api.sjsShelf.invalidSjsUrl": "不是有效的司机社 URL",
  "api.sjsShelf.missingId": "缺少 id 参数",
  "api.sjsShelf.invalidId": "无效的 id",
  "api.sjsShelf.notFound": "收藏卡片不存在",
  "api.sjsShelf.refreshFailed": "刷新元数据失败",
  "api.sjsShelf.unknownAction": "未知操作",

  // 搜索
  "api.search.missingJobId": "请提供 jobId",
  "api.search.batchScrapeStarted": "批量爬取已启动",
  "api.search.missingPageUrl": "请提供 pageUrl",
  "api.search.videoNotFound": "未找到对应的视频项",
  "api.search.missingKeyword": "请提供搜索关键词",
  "api.search.missingVideoTitle": "请提供视频标题",

  // 主角
  "api.protagonist.galleryNotFound": "未找到该主角的图库",
  "api.protagonist.fetchFailed": "获取主角信息失败",

  // OUO 编排
  "api.ouo.missingParams": "缺少必需参数: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "缺少必需参数: galleryId",

  // 图库
  "api.gallery.notFound": "图库不存在",
  "api.gallery.noProviderMatch": "无法找到匹配的站点提供者无法重新爬取",
  "api.gallery.rescrapeStarted": "图库重新爬取已启动",
  "api.gallery.retryFailedStarted": "失败文件重试已启动",
  "api.gallery.downloadStarted": "图库下载已启动",
  "api.gallery.noZipInfo": "该图库无 ZIP 下载信息",
  "api.gallery.noDownloadUrl": "无可用下载 URL请手动提供中转站链接",
  "api.gallery.invalidSource": "仅 ouo.io 来源支持编排器入队当前来源为 {source}",
  "api.gallery.noZipData": "无 ZIP 下载信息",
  "api.gallery.noProvider": "未找到匹配的站点提供者",
  "api.gallery.alreadyScraping": "该图库正在被其他任务爬取请稍后重试",
  "api.gallery.pageNotFound": "页面不存在 (404)",
  "api.gallery.pageNotFoundSkipped": "页面不存在 (404)已跳过",
  "api.gallery.identifying": "图库正在识别中请等待识别完成后再开始下载",
  "api.gallery.scrapeComplete": "图库爬取完成下载已异步启动",
  "api.gallery.batchMissingUrls": "urls 参数必须是非空数组",
  "api.gallery.batchEmptyUrl": "空 URL",
  "api.gallery.noProviderForRescrape": "无法匹配图库提供商无法重新爬取",

  // 任务
  "api.tasks.noM3u8Extracted": "无法从页面提取 M3U8 链接",

  // 屏蔽词库
  "api.blocklist.addFailed": "添加失败",

  // 日志
  "api.logs.systemReady": "系统就绪，等待任务...",
  "api.logs.taskNumber": "任务 #{id}",
  "api.logs.fetchFailed": "日志获取失败",

  // 图库（补充）
  "api.gallery.unsupportedScrape": "站点 {site} 不支持图库爬取",
  "api.gallery.allDomainsFailed": "所有域名均爬取失败",

  // 任务（补充）
  "api.tasks.multipleM3u8Detected": "检测到 {count} 个 M3U8 地址，请选择",
  "api.tasks.unsupportedListScrape": "Provider 不支持列表页爬取",

  // 通用
  "api.characterDb.syncRunning": "同步任务正在运行中",
  "api.common.internalError": "服务器内部错误",
  "api.common.missingParams": "缺少必需参数: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} 未找到",
  "api.dag.invalidAction": "无效操作: {action}",
  "api.dag.schedulerRequired": "DAG 控制需要调度器（Phase 3）",

  // Go 后端通用错误
  "api.common.databaseUnavailable": "数据库不可用",
  "api.common.missingBody": "请求体不能为空",
  "api.common.invalidJson": "无效的 JSON 请求体",
  "api.common.endpointNotFound": "接口不存在",
  "api.common.methodNotAllowed": "方法不允许",
  "api.common.streamingNotSupported": "不支持流式传输",
  "api.common.invalidId": "无效的 ID",
  "api.common.keyRequired": "key 为必填项",

  // Go 后端 — 账户管理
  "api.accounts.queryFailed": "查询账户失败",
  "api.accounts.missingFields": "siteId、username 和 password 为必填项",
  "api.accounts.createFailed": "创建账户失败",
  "api.accounts.updateFailed": "更新账户失败",
  "api.accounts.deleteFailed": "删除账户失败",

  // Go 后端 — 主角管理
  "api.persons.queryFailed": "查询主角失败",
  "api.persons.missingName": "name 为必填项",
  "api.persons.createFailed": "创建主角失败",
  "api.persons.updateFailed": "更新主角失败",
  "api.persons.deleteFailed": "删除主角失败",

  // Go 后端 — 屏蔽词库
  "api.blocklist.queryFailed": "查询屏蔽规则失败",
  "api.blocklist.missingFields": "fieldType 和 keyword 为必填项",
  "api.blocklist.createFailed": "创建屏蔽规则失败",
  "api.blocklist.updateFailed": "更新屏蔽规则失败",
  "api.blocklist.deleteFailed": "删除屏蔽规则失败",

  // Go 后端 — 配置
  "api.config.queryFailed": "查询配置失败",
  "api.config.updateFailed": "更新配置失败",

  // Go 后端 — 用户偏好
  "api.preferences.queryFailed": "查询用户偏好失败",
  "api.preferences.updateFailed": "更新用户偏好失败",

  // Go 后端 — 任务
  "api.tasks.queryFailed": "查询任务失败",
  "api.tasks.missingUrl": "URL 为必填项",
  "api.tasks.createFailed": "创建任务失败",
  "api.tasks.invalidId": "无效的任务 ID",
  "api.tasks.notFound": "任务不存在",
  "api.tasks.schedulerRequired": "任务操作需要调度器（Phase 3）",

  // Go 后端 — 图库
  "api.gallery.queryFailed": "查询图库失败",
  "api.gallery.invalidId": "无效的图库 ID",
  "api.gallery.queryImagesFailed": "查询图片失败",

  // Go 后端 — 下载历史
  "api.history.queryFailed": "查询下载历史失败",

  // Go 后端 — SJS 收藏架（补充）
  "api.sjsShelf.queryFailed": "查询司机社收藏失败",
  "api.sjsShelf.missingUrlAndThreadId": "URL 和 threadId 为必填项",
  "api.sjsShelf.createFailed": "创建收藏失败",
  "api.sjsShelf.deleteFailed": "删除收藏失败",
  "api.sjsShelf.missingUrlParam": "URL 参数为必填项",
  "api.sjsShelf.missingGalleryId": "galleryId 为必填项",
} satisfies TranslationDict;

/** Api 模块的翻译键联合类型 */
export type ApiTranslationKeys = keyof typeof zhCN;

export default zhCN;
