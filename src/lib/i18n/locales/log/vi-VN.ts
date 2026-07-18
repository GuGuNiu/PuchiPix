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

  "log.seed.presetDataSeeded": "Dữ liệu cài sẵn đã ghi vào cơ sở dữ liệu: {prefs} tùy chọn, {blocklists} quy tắc chặn",
};

export default viVN;
