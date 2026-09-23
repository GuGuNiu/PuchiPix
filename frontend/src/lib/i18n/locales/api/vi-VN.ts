import type { TranslationDict } from "../../types";

// API error messages — vi-VN
const viVN: TranslationDict = {
  // Task settings validation
  "api.validation.maxConcurrentTasks": "Số tác vụ đồng thời tối đa phải từ 1 đến 50",
  "api.validation.maxSniffConcurrent": "Số sniff tối đa phải từ 1 đến 10",
  "api.validation.maxScrapingSlots": "Số slot nhận dạng tối đa phải từ 1 đến 50",
  "api.validation.tsSegmentConcurrent": "Số TS segment đồng thời phải từ 1 đến 200",
  "api.validation.galleryImageConcurrent": "Số ảnh thư viện đồng thời phải từ 1 đến 50",

  // SJS forum actions
  "api.sjs.missingAction": "Thiếu tham số action",
  "api.sjs.signMissingAccountId": "Điểm danh yêu cầu tham số accountId",
  "api.sjs.buyMissingAccountId": "Mua bài đăng yêu cầu tham số accountId",
  "api.sjs.buyMissingTid": "Mua bài đăng yêu cầu tham số tid (ID bài đăng)",
  "api.sjs.loginMissingAccountId": "Đăng nhập yêu cầu tham số accountId",

  // SJS Shelf
  "api.sjsShelf.noUrls": "Vui lòng cung cấp danh sách URL",
  "api.sjsShelf.emptyUrl": "URL trống",
  "api.sjsShelf.invalidSjsUrl": "Không phải URL SJS hợp lệ",
  "api.sjsShelf.missingId": "Thiếu tham số id",
  "api.sjsShelf.invalidId": "id không hợp lệ",
  "api.sjsShelf.notFound": "Không tìm thấy bookmark",
  "api.sjsShelf.refreshFailed": "Làm mới metadata thất bại",
  "api.sjsShelf.unknownAction": "Hành động không xác định",

  // Search
  "api.search.missingJobId": "Vui lòng cung cấp jobId",
  "api.search.batchScrapeStarted": "Cào hàng loạt đã bắt đầu",
  "api.search.missingPageUrl": "Vui lòng cung cấp pageUrl",
  "api.search.videoNotFound": "Không tìm thấy mục video",
  "api.search.missingKeyword": "Vui lòng cung cấp từ khóa tìm kiếm",
  "api.search.missingVideoTitle": "Vui lòng cung cấp tiêu đề video",

  // Protagonist
  "api.protagonist.galleryNotFound": "Không tìm thấy thư viện cho nhân vật này",
  "api.protagonist.fetchFailed": "Tải thông tin nhân vật thất bại",

  // OUO orchestration
  "api.ouo.missingParams": "Thiếu tham số bắt buộc: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Thiếu tham số bắt buộc: galleryId",

  // Gallery
  "api.gallery.notFound": "Không tìm thấy thư viện",
  "api.gallery.noProviderMatch": "Không tìm thấy nhà cung cấp trang web phù hợp, không thể cào lại",
  "api.gallery.rescrapeStarted": "Cào lại thư viện đã bắt đầu",
  "api.gallery.retryFailedStarted": "Thử lại tệp thất bại đã bắt đầu",
  "api.gallery.downloadStarted": "Tải thư viện đã bắt đầu",
  "api.gallery.noZipInfo": "Thư viện này không có thông tin tải ZIP",
  "api.gallery.noDownloadUrl": "Không có URL tải xuống, vui lòng cung cấp liên kết mirror thủ công",
  "api.gallery.invalidSource": "Chỉ nguồn ouo.io hỗ trợ hàng đợi orchestrator, nguồn hiện tại là {source}",
  "api.gallery.noZipData": "Không có thông tin tải ZIP",
  "api.gallery.noProvider": "Không tìm thấy nhà cung cấp trang web phù hợp",
  "api.gallery.alreadyScraping": "Thư viện này đang được cào bởi tác vụ khác, vui lòng thử lại sau",
  "api.gallery.pageNotFound": "Không tìm thấy trang (404)",
  "api.gallery.pageNotFoundSkipped": "Không tìm thấy trang (404), đã bỏ qua",
  "api.gallery.identifying": "Thư viện đang nhận dạng, vui lòng đợi nhận dạng hoàn tất trước khi tải",
  "api.gallery.scrapeComplete": "Cào thư viện hoàn tất, tải xuống đã bắt đầu bất đồng bộ",
  "api.gallery.batchMissingUrls": "Tham số urls phải là mảng không trống",
  "api.gallery.batchEmptyUrl": "URL trống",
  "api.gallery.noProviderForRescrape": "Không tìm thấy nhà cung cấp thư viện, không thể cào lại",

  // Tasks
  "api.tasks.noM3u8Extracted": "Không thể trích xuất liên kết M3U8 từ trang",

  // Blocklist
  "api.blocklist.addFailed": "Thêm thất bại",

  // Logs
  "api.logs.systemReady": "Hệ thống sẵn sàng, đang chờ tác vụ...",
  "api.logs.taskNumber": "Tác vụ #{id}",
  "api.logs.fetchFailed": "Tải nhật ký thất bại",

  // Gallery (supplement)
  "api.gallery.unsupportedScrape": "Trang {site} không hỗ trợ cào thư viện",
  "api.gallery.allDomainsFailed": "Tất cả tên miền đều cào thất bại",

  // Tasks (supplement)
  "api.tasks.multipleM3u8Detected": "Đã phát hiện {count} địa chỉ M3U8, vui lòng chọn",
  "api.tasks.unsupportedListScrape": "Provider không hỗ trợ cào trang danh sách",

  // Common
  "api.characterDb.syncRunning": "Tác vụ đồng bộ đang chạy",
  "api.common.internalError": "Lỗi máy chủ nội bộ",
  "api.common.missingParams": "Thiếu tham số bắt buộc: {params}",

  // DAG
  "api.dag.notFound": "Không tìm thấy DAG {dagId}",
  "api.dag.invalidAction": "Thao tác không hợp lệ: {action}",
  "api.accounts.createFailed": "Tạo tài khoản thất bại",
  "api.accounts.deleteFailed": "Xóa tài khoản thất bại",
  "api.accounts.missingFields": "siteId, username và password là bắt buộc",
  "api.accounts.queryFailed": "Truy vấn tài khoản thất bại",
  "api.accounts.updateFailed": "Cập nhật tài khoản thất bại",
  "api.blocklist.createFailed": "Tạo quy tắc chặn thất bại",
  "api.blocklist.deleteFailed": "Xóa quy tắc chặn thất bại",
  "api.blocklist.missingFields": "fieldType và keyword là bắt buộc",
  "api.blocklist.queryFailed": "Truy vấn quy tắc chặn thất bại",
  "api.blocklist.updateFailed": "Cập nhật quy tắc chặn thất bại",
  "api.common.databaseUnavailable": "Cơ sở dữ liệu không khả dụng",
  "api.common.endpointNotFound": "Không tìm thấy điểm cuối",
  "api.common.invalidId": "ID không hợp lệ",
  "api.common.invalidJson": "Nội dung JSON yêu cầu không hợp lệ",
  "api.common.keyRequired": "Tham số key là bắt buộc",
  "api.common.methodNotAllowed": "Phương thức không được phép",
  "api.common.missingBody": "Nội dung yêu cầu không được để trống",
  "api.common.streamingNotSupported": "Không hỗ trợ truyền phát",
  "api.config.queryFailed": "Truy vấn cấu hình thất bại",
  "api.config.updateFailed": "Cập nhật cấu hình thất bại",
  "api.dag.schedulerRequired": "Điều khiển DAG yêu cầu trình lập lịch (Phase 3)",
  "api.gallery.invalidId": "ID bộ sưu tập không hợp lệ",
  "api.gallery.queryFailed": "Truy vấn bộ sưu tập thất bại",
  "api.gallery.queryImagesFailed": "Truy vấn hình ảnh thất bại",
  "api.history.queryFailed": "Truy vấn lịch sử tải xuống thất bại",
  "api.persons.createFailed": "Tạo diễn viên thất bại",
  "api.persons.deleteFailed": "Xóa diễn viên thất bại",
  "api.persons.missingName": "Tham số name là bắt buộc",
  "api.persons.queryFailed": "Truy vấn diễn viên thất bại",
  "api.persons.updateFailed": "Cập nhật diễn viên thất bại",
  "api.preferences.queryFailed": "Truy vấn tùy chọn người dùng thất bại",
  "api.preferences.updateFailed": "Cập nhật tùy chọn người dùng thất bại",
  "api.sjsShelf.createFailed": "Tạo dấu trang thất bại",
  "api.sjsShelf.deleteFailed": "Xóa dấu trang thất bại",
  "api.sjsShelf.missingGalleryId": "Tham số galleryId là bắt buộc",
  "api.sjsShelf.missingUrlAndThreadId": "URL và threadId là bắt buộc",
  "api.sjsShelf.missingUrlParam": "Tham số URL là bắt buộc",
  "api.sjsShelf.queryFailed": "Truy vấn dấu trang SJS thất bại",
  "api.tasks.createFailed": "Tạo tác vụ thất bại",
  "api.tasks.invalidId": "ID tác vụ không hợp lệ",
  "api.tasks.missingUrl": "URL là bắt buộc",
  "api.tasks.notFound": "Không tìm thấy tác vụ",
  "api.tasks.queryFailed": "Truy vấn tác vụ thất bại",
  "api.tasks.schedulerRequired": "Thao tác tác vụ yêu cầu trình lập lịch (Phase 3)",
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

export default viVN;
