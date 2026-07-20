import type { TranslationDict } from "../../types";

const koKR: TranslationDict = {
  // 작업 설정 검증
  "api.validation.maxConcurrentTasks": "동시 실행 작업 수는 1~50 사이여야 합니다",
  "api.validation.maxSniffConcurrent": "최대 탐색 동시 수는 1~10 사이여야 합니다",
  "api.validation.maxScrapingSlots": "최대 식별 수는 1~50 사이여야 합니다",
  "api.validation.tsSegmentConcurrent": "TS 세그먼트 동시 수는 1~200 사이여야 합니다",
  "api.validation.galleryImageConcurrent": "갤러리 이미지 동시 수는 1~50 사이여야 합니다",

  // SJS 포럼 작업
  "api.sjs.missingAction": "action 파라미터 누락",
  "api.sjs.signMissingAccountId": "출석 체크에는 accountId 파라미터가 필요합니다",
  "api.sjs.buyMissingAccountId": "게시글 구매에는 accountId 파라미터가 필요합니다",
  "api.sjs.buyMissingTid": "게시글 구매에는 tid 파라미터(게시글 ID)가 필요합니다",
  "api.sjs.loginMissingAccountId": "로그인에는 accountId 파라미터가 필요합니다",

  // 검색
  "api.search.missingJobId": "jobId를 제공하세요",
  "api.search.batchScrapeStarted": "배치 크롤링이 시작되었습니다",
  "api.search.missingPageUrl": "pageUrl을 제공하세요",
  "api.search.videoNotFound": "해당하는 동영상 항목을 찾을 수 없습니다",
  "api.search.missingKeyword": "검색 키워드를 제공하세요",
  "api.search.missingVideoTitle": "동영상 제목을 제공하세요",

  // 주인공
  "api.protagonist.galleryNotFound": "이 주인공의 갤러리를 찾을 수 없습니다",
  "api.protagonist.fetchFailed": "주인공 정보 가져오기 실패",

  // OUO 오케스트레이션
  "api.ouo.missingParams": "필수 파라미터 누락: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "필수 파라미터 누락: galleryId",

  // 갤러리
  "api.gallery.notFound": "갤러리가 존재하지 않습니다",
  "api.gallery.noProviderMatch": "일치하는 사이트 제공자를 찾을 수 없어 재크롤링할 수 없습니다",
  "api.gallery.rescrapeStarted": "갤러리 재크롤링이 시작되었습니다",
  "api.gallery.retryFailedStarted": "실패 파일 재시도가 시작되었습니다",
  "api.gallery.downloadStarted": "갤러리 다운로드가 시작되었습니다",
  "api.gallery.noZipInfo": "이 갤러리에는 ZIP 다운로드 정보가 없습니다",
  "api.gallery.noDownloadUrl": "사용 가능한 다운로드 URL 없음, 수동으로 중계 사이트 링크를 제공하세요",
  "api.gallery.invalidSource": "ouo.io 출처만 오케스트레이터 큐 입력을 지원합니다, 현재 출처: {source}",
  "api.gallery.noZipData": "ZIP 다운로드 정보 없음",
  "api.gallery.noProvider": "일치하는 사이트 제공자를 찾을 수 없습니다",
  "api.gallery.alreadyScraping": "이 갤러리는 다른 작업에서 크롤링 중입니다, 잠시 후 재시도하세요",
  "api.gallery.pageNotFound": "페이지를 찾을 수 없음 (404)",
  "api.gallery.pageNotFoundSkipped": "페이지를 찾을 수 없음 (404), 건너뜀",
  "api.gallery.identifying": "갤러리 식별 중입니다, 식별 완료 후 다운로드를 시작하세요",
  "api.gallery.scrapeComplete": "갤러리 크롤링 완료, 다운로드가 비동기로 시작되었습니다",
  "api.gallery.batchMissingUrls": "urls 파라미터는 비어 있지 않은 배열이어야 합니다",
  "api.gallery.batchEmptyUrl": "빈 URL",
  "api.gallery.noProviderForRescrape": "갤러리 제공자를 매칭할 수 없어 재크롤링할 수 없습니다",

  // 작업
  "api.tasks.noM3u8Extracted": "페이지에서 M3U8 링크를 추출할 수 없습니다",

  // 차단 단어
  "api.blocklist.addFailed": "추가 실패",

  // 로그
  "api.logs.systemReady": "시스템 준비 완료, 작업 대기 중...",
  "api.logs.taskNumber": "작업 #{id}",
  "api.logs.fetchFailed": "로그 가져오기 실패",

  // 갤러리 (보충)
  "api.gallery.unsupportedScrape": "사이트 {site}는 갤러리 스크래핑을 지원하지 않습니다",
  "api.gallery.allDomainsFailed": "모든 도메인 스크래핑 실패",

  // 작업 (보충)
  "api.tasks.multipleM3u8Detected": "{count}개의 M3U8 주소가 감지되었습니다, 선택하세요",
  "api.tasks.unsupportedListScrape": "제공자가 목록 페이지 스크래핑을 지원하지 않습니다",

  // 공통
  "api.characterDb.syncRunning": "동기화 작업이 실행 중입니다",
  "api.common.internalError": "서버 내부 오류",
  "api.common.missingParams": "필수 파라미터 누락: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId}를 찾을 수 없습니다",
  "api.dag.invalidAction": "잘못된 작업: {action}",
};

export default koKR;
