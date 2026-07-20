import type { TranslationDict } from "../../types";

// Mẫu thông báo nhật ký — Tiếng Việt
const viVN: TranslationDict = {
  // Xóa an toàn
  "log.safeDelete.fileFailed": "Xóa tệp thất bại ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "Xóa tệp cuối cùng thất bại: {path} — {msg}",
  "log.safeDelete.dirFailed": "Xóa thư mục thất bại ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "Xóa thư mục cuối cùng thất bại: {path} — {msg}",

  // Thư viện Handler
  "log.galleryHandler.cancelledInQueue": "Thư viện #{id} bị hủy khi đang chờ trong hàng đợi",
  "log.galleryHandler.cancelledInScrapeQueue": "Thư viện #{id} bị hủy khi đang chờ trong hàng đợi cào",
  "log.galleryHandler.domainRateLimited": "Tên miền {url} trả về {status} (giới hạn tốc độ), chuyển đổi nhanh",
  "log.galleryHandler.asyncScrapeError": "Lỗi cào bất đồng bộ thư viện #{id}",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",
  "log.galleryHandler.downloadFailed": "Download failed: {msg}",
  "log.galleryHandler.downloadComplete": "Download complete: {success} succeeded, {failed} failed, {skipped} skipped",

  // Trang web SJS
  "log.sjs.noAccount": "Không có tài khoản khả dụng, truy cập với chế độ khách (nội dung đầy đủ có thể không hiển thị)",
  "log.sjs.cookieInjected": "Cookie tài khoản #{id} đã được chèn ({count} mục)",
  "log.sjs.cookieInjectionFailed": "Chèn Cookie thất bại, sẽ thử đăng nhập lại",
  "log.sjs.noCookieStartLogin": "Không có Cookie hợp lệ, bắt đầu quy trình đăng nhập...",
  "log.sjs.loginSuccess": "Đăng nhập tài khoản #{id} thành công, Cookie đã được lưu ({count} mục)",
  "log.sjs.loginFailed": "Đăng nhập thất bại",
  "log.sjs.paidContent": "Bài đăng là nội dung trả phí, phải mua mới có thể xem liên kết tải xuống",
  "log.sjs.detectedDownloadLinks": "Phát hiện {count} liên kết tải xuống (bài đăng đã mua)",
  "log.sjs.pageNewImages": "Trang bài đăng {page}: ảnh mới (tổng {total})",
  "log.sjs.scrapePageFailed": "Cào trang bài đăng {page} thất bại",
  "log.sjs.learnPersonFailed": "learnPerson thất bại",
  "log.sjs.listPageNoResults": "Trang danh sách {page}: không có kết quả, kết thúc",
  "log.sjs.listPageNewResults": "Trang danh sách {page}: {count} kết quả mới (tổng {total})",
  "log.sjs.listPageNoNext": "Không có liên kết trang tiếp theo, kết thúc",
  "log.sjs.navNextFailed": "Điều hướng đến trang tiếp theo thất bại",
  "log.sjs.gotFormhash": "Nhận formhash: {value}",
  "log.sjs.httpLoginSuccess": "Đăng nhập HTTP thành công ({count} Cookie)",
  "log.sjs.signLink": "Liên kết điểm danh: {href}",
  "log.sjs.postNotPurchased": "Bài đăng \"{title}\" chưa được mua, bắt đầu quy trình mua...",
  "log.sjs.buyFormParams": "Tham số form mua: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "Bắt đầu điểm danh: {username}",

  // Đăng ký trang web
  "log.siteRegistry.providerNotFound": "Không tìm thấy triển khai Provider cho trang web \"{id}\"",

  // Quản lý tài khoản trang web
  "log.siteAccountManager.cookieSaved": "Cookie tài khoản #{id} đã được lưu ({count} mục)",

  // ExHentai
  "log.exhentai.scrapePageFailed": "Cào trang thư viện {page} thất bại",
  "log.exhentai.pageNewLinks": "Trang thư viện {page}: thu thập {count} liên kết trang ảnh (tổng {total})",
  "log.exhentai.batchFailed": "Tải URL ảnh hàng loạt thất bại (lô {batch})",
  "log.exhentai.listPageNoResults": "Trang danh sách {page}: không có kết quả, kết thúc",
  "log.exhentai.listPageNewResults": "Trang danh sách {page}: {count} kết quả mới (tổng {total})",
  "log.exhentai.listPageNoNext": "Không có liên kết trang tiếp theo, kết thúc",
  "log.exhentai.navNextFailed": "Điều hướng đến trang tiếp theo thất bại",

  // Aimeizizi
  "log.aimeizizi.learnPersonFailed": "learnPerson thất bại",
  "log.aimeizizi.blockedSearchResult": "Kết quả tìm kiếm bị chặn: \"{title}...\", lý do: {reason}",
  "log.aimeizizi.domainRateLimited": "Trang {page} nhận {status}, đánh dấu tên miền {domain} là giới hạn tốc độ",
  "log.aimeizizi.domainSwitchSuccess": "Trang {page} chuyển sang tên miền {domain} thành công",
  "log.aimeizizi.domainSwitchFailed": "Trang {page} tên miền {domain} thất bại: {msg}",
  "log.aimeizizi.scrapePageFailed": "Cào trang {page} thất bại (tên miền {domain})",
  "log.aimeizizi.blockedGalleryScrape": "Cào thư viện bị chặn: \"{title}...\", lý do: {reason}",
  "log.aimeizizi.gameCharDetected": "Phát hiện nhân vật trò chơi: {chars}",
  "log.aimeizizi.listPageFailed": "Cào trang danh sách {page} thất bại",

  // Cào chung
  "log.scrape.capturedM3u8": "{url} — bắt được {count} URL M3U8: {urls}",

  // Dịch vụ nhân vật
  "log.protagonist.personCacheInitFailed": "Khởi tạo bộ nhớ đệm Person thất bại",

  // Công cụ tìm kiếm
  "log.search.batchComplete": "Cào hàng loạt hoàn tất! {ok} thành công, {fail} thất bại",
  "log.search.terminated": "Search task terminated abnormally: {msg}",
  "log.search.batchTerminated": "Batch search task terminated abnormally: {msg}",
  "log.taskCreator.downloadStartFailed": "Download task #{taskId} failed to start: {msg}",
  "log.parallelDL.writeFailed": "[ParallelDL] Write failed: {msg}",
  "log.parallelDL.requestFailed": "[ParallelDL] Request failed: {msg}",
  "log.downloadManager.segmentFailed": "  Segment #{idx}: {msg}",
  "log.downloadManager.incomplete": "Download incomplete: {failedCount} segments failed (out of {totalSegments} total)\n{details}",

  // Trình quản lý hàng đợi tác vụ
  "log.taskQueue.slotAllocated": "Slot được phân bổ: {key} (đang chạy: thường={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "Slot được giải phóng: {key} (đang chạy: thường={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "Slot nhận dạng được phân bổ: {key} (nhận dạng: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "Slot nhận dạng được giải phóng: {key} (nhận dạng: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "Tác vụ đang chờ bị hủy: {type}-{id}",
  "log.taskQueue.scrapingCancel": "Tác vụ nhận dạng đang chờ bị hủy: {type}-{id}",
  "log.taskQueue.pendingGranted": "Tác vụ đang chờ nhận slot: {key} (đang chạy: thường={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "Tác vụ nhận dạng đang chờ nhận slot: {key} (nhận dạng: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "Slot đầy, tác vụ xếp hàng: {key} (vị trí hàng đợi {position})",
  "log.taskQueue.scrapingFull": "Slot nhận dạng đầy, tác vụ xếp hàng: {key} (vị trí hàng đợi {position})",
  "log.taskQueue.configLoaded": "Cấu hình đã tải: thường tối đa={maxConcurrent}, nhận dạng tối đa={maxScraping}, sniff tối đa={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.configUpdated": "Cấu hình đã cập nhật: thường tối đa={maxConcurrent}, nhận dạng tối đa={maxScraping}, sniff tối đa={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.configSeeded": "Cấu hình mặc định đã ghi vào CSDL: {keys}",
  "log.taskQueue.listenersRegistered": "Trình nghe trạng thái cuối EventBus đã được đăng ký",
  "log.taskQueue.resetWarn": "Bộ đếm bị buộc đặt lại",
"log.taskQueue.startupRecovery": "Khôi phục khởi động: đã xếp lại {count} tác vụ",
  "log.taskQueue.configLoadFailed": "Tải cấu hình thất bại, sử dụng giá trị mặc định: {error}",

  // Vòng đời máy chủ
  "log.server.taskStateReset": "Hoàn tất đặt lại trạng thái tác vụ khi khởi động",
  "log.server.downloadManagerInit": "Trình quản lý tải xuống đã được khởi tạo",
  "log.server.eventBusBridgeInit": "Cầu EventBus đã được khởi tạo",
  "log.server.ouoOrchestratorStart": "Bộ điều phối OUO đã khởi động",

  // Đặt lại trạng thái tác vụ
  "log.taskStateReset.started": "Bắt đầu đặt lại trạng thái tác vụ đang chạy...",
  "log.taskStateReset.cleanupSlots": "Dọn dẹp slot cũ: thường={normal}, sniff={sniff}, nhận dạng={scraping}",
  "log.taskStateReset.completed": "Hoàn tất đặt lại: video {videoTasks}, thư viện {galleries}, ảnh {galleryImages}, video {galleryVideos}, sniff {sniffTasks}, thông tin ZIP {galleryDownloadInfos}, tổng {total} tác vụ đã được đặt lại",
  "log.taskStateReset.noop": "Không tìm thấy tác vụ đang chạy, không cần đặt lại",
  "log.taskStateReset.suspended": "Máy chủ khởi động lại, tác vụ đã tạm dừng",

  "log.seed.presetDataSeeded": "Dữ liệu cài sẵn đã ghi vào cơ sở dữ liệu: {prefs} tùy chọn, {blocklists} quy tắc chặn",
  "log.dagOrchestrator.initComplete": "[DagOrchestrator] Khởi tạo hoàn tất",
  "log.dagOrchestrator.dagCompleted": "[DagOrchestrator] DAG {dagId} hoàn tất toàn bộ",
  "log.dagOrchestrator.dagEndedWithFailure": "[DagOrchestrator] DAG {dagId} đã kết thúc (có lỗi/hủy)",
  "log.dagOrchestrator.updateGalleryStatusFailed": "[DagOrchestrator] Cập nhật trạng thái thư viện {galleryId} thất bại",
  "log.dagOrchestrator.dagCancelled": "[DagOrchestrator] DAG {dagId} đã hủy",
  "log.dagOrchestrator.dagNotFoundCannotResume": "[DagOrchestrator] DAG {dagId} không tìm thấy, không thể tiếp tục",
  "log.dagOrchestrator.resumeNodeFailedQueueFull": "[DagOrchestrator] Tiếp tục node {nodeId} gửi thất bại, hàng đợi đầy, giữ trạng thái READY",
  "log.dagOrchestrator.dagResumeComplete": "[DagOrchestrator] DAG {dagId} tiếp tục hoàn tất: {resumedCount}/{totalCount} node đã gửi lại",
  "log.dagOrchestrator.restoreDag": "[DagOrchestrator] Khôi phục DAG {dagId} ({nodeCount} node)",
  "log.dagOrchestrator.restartRecoveryComplete": "[DagOrchestrator] Khôi phục khởi động lại hoàn tất: {pausedCount} node tạm dừng, chờ khôi phục thủ công",
  "log.dagOrchestrator.retryNodes": "[DagOrchestrator] DAG {dagId} thử lại {nodeCount} node",
  "log.dagOrchestrator.dagSubmitted": "[DagOrchestrator] DAG {dagId} đã gửi ({nodeCount} node)",
  "log.dagOrchestrator.nodeSubmitFailedQueueFull": "[DagOrchestrator] Node {nodeId} gửi thất bại, hàng đợi đầy, giữ trạng thái READY, chờ thử lại",
  "log.dagOrchestrator.nodeNotFoundCannotTransition": "[DagOrchestrator] Node {nodeId} không tìm thấy, không thể chuyển trạng thái",
  "log.dagSystem.alreadyInitialized": "[DagSystem] Đã khởi tạo, bỏ qua",
  "log.dagSystem.initComplete": "[DagSystem] Khởi tạo hoàn tất (cờ tính năng: {status})",
  "log.dagSystem.initFailed": "[DagSystem] Khởi tạo thất bại",
  "log.dagSystem.timerStarted": "[DagSystem] Bộ hẹn giờ đã bắt đầu",
  "log.dagSystem.stopped": "[DagSystem] Đã dừng",
  "log.dagSystem.gracefulShutdownComplete": "[DagSystem] Tắt nhẹ nhàng hoàn tất",
  "log.orchestratorBase.alreadyRunning": "[{name}] Đang chạy, bỏ qua",
  "log.orchestratorBase.started": "[{name}] Orchestrator đã bắt đầu",
  "log.orchestratorBase.stopping": "[{name}] Orchestrator đang dừng...",
  "log.orchestratorBase.waitingForTask": "[{name}] Đợi tác vụ #{taskId} hoàn tất...",
  "log.orchestratorBase.stopped": "[{name}] Orchestrator đã dừng",
  "log.orchestratorBase.paused": "[{name}] Orchestrator đã tạm dừng",
  "log.orchestratorBase.resumed": "[{name}] Orchestrator đã tiếp tục",
  "log.orchestratorBase.taskCancelled": "[{name}] Tác vụ đã hủy ID={id}",
  "log.orchestratorBase.queueCleared": "[{name}] Hàng đợi đã xóa (đã xóa {count} tác vụ đang chờ)",
  "log.orchestratorBase.taskDependencyFailed": "[{name}] Tác vụ hủy do phụ thuộc thất bại: ID={id}",
  "log.orchestratorBase.rateLimitWaiting": "[{name}] Giới hạn tốc độ đang nguội, chờ {waitMs}s...",
  "log.orchestratorBase.rateLimitResume": "[{name}] Hết nguội giới hạn tốc độ, tiếp tục xử lý hàng đợi",
  "log.orchestratorBase.queueSummary": "[{name}] Trạng thái hàng đợi (tổng {total} tác vụ, {success} thành công, {failed} thất bại)",
  "log.orchestratorBase.startProcessing": "[{name}] Bắt đầu xử lý: ID={taskId} (tác vụ #{count})",
  "log.orchestratorBase.taskSuccess": "[{name}] Tác vụ thành công: ID={taskId}",
  "log.orchestratorBase.taskFailedRetry": "[{name}] Tác vụ thất bại, thử lại (lần {retryCount}): ID={taskId}, chờ {waitSec}s",
  "log.orchestratorBase.taskFailedExhausted": "[{name}] Tác vụ thất bại (hết lượt thử): ID={taskId}: {errorMsg}",
  "log.orchestratorBase.queueFullRejected": "[{name}] Hàng đợi đầy ({pending}/{max}), từ chối: ID={id} (tổng từ chối {rejected})",
  "log.orchestratorBase.taskEnqueued": "[{name}] Tác vụ vào hàng: ID={id}, vị trí {position} (hàng đợi {current}/{max})",
  "log.orchestratorBase.processingLoopError": "[{name}] Ngoại lệ vòng xử lý:",
  "log.orchestratorBase.taskFailedDefault": "Tác vụ thất bại",
  "log.orchestratorBase.taskExceptionRetry": "[{name}] Ngoại lệ tác vụ, thử lại (lần {retryCount}): ID={taskId}, chờ {waitSec}s",
  "log.orchestratorBase.taskExceptionExhausted": "[{name}] Ngoại lệ tác vụ (hết lượt thử): ID={taskId}: {errorMsg}",
  "log.orchestratorBase.ipRateLimited": "Giới hạn tốc độ IP",
  "log.orchestratorBase.rateLimitTriggered": "[{name}] Kích hoạt giới hạn tốc độ: ID={id}, nguội {minutes} phút",
  "log.orchestratorBase.cooldownResumeRequeue": "[{name}] Hết nguội, tác vụ vào lại hàng: ID={id} (thử lại lần {retryCount})",
  "log.orchestratorBase.ipRateLimitExhausted": "Giới hạn tốc độ IP (hết lượt thử)",
  "log.orchestratorBase.cooldownEndExhausted": "[{name}] Hết nguội nhưng hết lượt thử: ID={id}",
  "log.dagConfig.schedulerToggle": "[DagConfig] Bộ lập lịch DAG {status}",
  "log.dagConfig.taskTypesUpdated": "[DagConfig] Cập nhật loại tác vụ DAG: [{value}]",
  "log.dagConfig.configLoadComplete": "[DagConfig] Tải cấu hình hoàn tất: enabled={enabled}, taskTypes=[{taskTypes}]",
  "log.dagConfig.configLoadFailed": "[DagConfig] Tải cấu hình thất bại:",
  "log.dagConfig.usingDefaultConfig": "[DagConfig] Dùng cấu hình mặc định: enabled=true (hạ cấp an toàn sau khi tải thất bại)",

};

export default viVN;
