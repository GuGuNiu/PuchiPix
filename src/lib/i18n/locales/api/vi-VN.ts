import type { TranslationDict } from "../../types";

// Thông báo lỗi API — Tiếng Việt
const viVN: TranslationDict = {
  // Xác thực cài đặt tác vụ
  "api.validation.maxConcurrentTasks": "Số tác vụ đồng thời tối đa phải từ 1 đến 50",
  "api.validation.maxSniffConcurrent": "Số sniff tối đa phải từ 1 đến 10",
  "api.validation.maxScrapingSlots": "Số slot nhận dạng tối đa phải từ 1 đến 50",
  "api.validation.tsSegmentConcurrent": "Số TS segment đồng thời phải từ 1 đến 200",
  "api.validation.galleryImageConcurrent": "Số ảnh thư viện đồng thời phải từ 1 đến 50",

  // Thao tác diễn đàn SJS
  "api.sjs.missingAction": "Thiếu tham số action",
  "api.sjs.signMissingAccountId": "Điểm danh yêu cầu tham số accountId",
  "api.sjs.buyMissingAccountId": "Mua bài đăng yêu cầu tham số accountId",
  "api.sjs.buyMissingTid": "Mua bài đăng yêu cầu tham số tid (ID bài đăng)",
  "api.sjs.loginMissingAccountId": "Đăng nhập yêu cầu tham số accountId",

  // Tìm kiếm
  "api.search.missingJobId": "Vui lòng cung cấp jobId",
  "api.search.batchScrapeStarted": "Cào hàng loạt đã bắt đầu",
  "api.search.missingPageUrl": "Vui lòng cung cấp pageUrl",
  "api.search.videoNotFound": "Không tìm thấy mục video",
  "api.search.missingKeyword": "Vui lòng cung cấp từ khóa tìm kiếm",
  "api.search.missingVideoTitle": "Vui lòng cung cấp tiêu đề video",

  // Nhân vật
  "api.protagonist.galleryNotFound": "Không tìm thấy thư viện cho nhân vật này",
  "api.protagonist.fetchFailed": "Tải thông tin nhân vật thất bại",

  // Điều phối OUO
  "api.ouo.missingParams": "Thiếu tham số bắt buộc: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Thiếu tham số bắt buộc: galleryId",

  // Thư viện
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

  // Tác vụ
  "api.tasks.noM3u8Extracted": "Không thể trích xuất liên kết M3U8 từ trang",

  // Danh sách chặn
  "api.blocklist.addFailed": "Thêm thất bại",

  // Nhật ký
  "api.logs.systemReady": "Hệ thống sẵn sàng, đang chờ tác vụ...",
  "api.logs.taskNumber": "Tác vụ #{id}",
  "api.logs.fetchFailed": "Tải nhật ký thất bại",

  // Thư viện (bổ sung)
  "api.gallery.unsupportedScrape": "Trang {site} không hỗ trợ cào thư viện",
  "api.gallery.allDomainsFailed": "Tất cả tên miền đều cào thất bại",

  // Tác vụ (bổ sung)
  "api.tasks.multipleM3u8Detected": "Đã phát hiện {count} địa chỉ M3U8, vui lòng chọn",
  "api.tasks.unsupportedListScrape": "Provider không hỗ trợ cào trang danh sách",

  // Chung
  "api.characterDb.syncRunning": "Tác vụ đồng bộ đang chạy",
  "api.common.internalError": "Lỗi máy chủ nội bộ",
  "api.common.missingParams": "Thiếu tham số bắt buộc: {params}",

  // DAG
  "api.dag.notFound": "Không tìm thấy DAG {dagId}",
  "api.dag.invalidAction": "Thao tác không hợp lệ: {action}",
};

export default viVN;
