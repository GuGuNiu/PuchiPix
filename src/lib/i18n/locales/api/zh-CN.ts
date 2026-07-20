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
} satisfies TranslationDict;

/** Api 模块的翻译键联合类型 */
export type ApiTranslationKeys = keyof typeof zhCN;

export default zhCN;
