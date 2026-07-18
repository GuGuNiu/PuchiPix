import type { TranslationDict } from "../../types";

// API 오류 메시지 — 한국어
const koKR: TranslationDict = {
  // 작업 설정 검증
  "api.validation.maxConcurrentTasks": "동시 실행 작업 수는 1~50 사이여야 합니다",
  "api.validation.maxSniffConcurrent": "스니핑 최대 동시 수는 1~10 사이여야 합니다",
  "api.validation.maxScrapingSlots": "식별 중 최대 수는 1~50 사이여야 합니다",
  "api.validation.tsSegmentConcurrent": "TS 세그먼트 동시 수는 1~200 사이여야 합니다",
  "api.validation.galleryImageConcurrent": "갤러리 이미지 동시 수는 1~50 사이여야 합니다",

  // SJS 포럼 작업
  "api.sjs.missingAction": "action 매개변수가 누락되었습니다",
  "api.sjs.signMissingAccountId": "출석체크에는 accountId 매개변수가 필요합니다",
  "api.sjs.buyMissingAccountId": "게시글 구매에는 accountId 매개변수가 필요합니다",
  "api.sjs.buyMissingTid": "게시글 구매에는 tid 매개변수가 필요합니다 (게시글 ID)",
  "api.sjs.loginMissingAccountId": "로그인에는 accountId 매개변수가 필요합니다",

  // 검색
  "api.search.missingJobId": "jobId를 제공하세요",
  "api.search.batchScrapeStarted": "일괄 스크랩이 시작되었습니다",
  "api.search.missingPageUrl": "pageUrl을 제공하세요",
  "api.search.videoNotFound": "해당 동영상 항목을 찾을 수 없습니다",
  "api.search.missingKeyword": "검색 키워드를 제공하세요",
  "api.search.missingVideoTitle": "동영상 제목을 제공하세요",

  // 캐릭터
  "api.protagonist.galleryNotFound": "이 캐릭터의 갤러리를 찾을 수 없습니다",
  "api.protagonist.fetchFailed": "캐릭터 정보 가져오기 실패",

  // OUO 오케스트레이션
  "api.ouo.missingParams": "필수 매개변수 누락: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "필수 매개변수 누락: galleryId",

  // 갤러리
  "api.gallery.notFound": "갤러리를 찾을 수 없습니다",
  "api.gallery.noProviderMatch": "일치하는 사이트 제공자를 찾을 수 없어 재스크랩할 수 없습니다",
  "api.gallery.rescrapeStarted": "갤러리 재스크랩이 시작되었습니다",
  "api.gallery.retryFailedStarted": "실패한 파일 재시도가 시작되었습니다",
  "api.gallery.downloadStarted": "갤러리 다운로드가 시작되었습니다",
  "api.gallery.noZipInfo": "이 갤러리에는 ZIP 다운로드 정보가 없습니다",
  "api.gallery.noDownloadUrl": "사용 가능한 다운로드 URL이 없습니다. 수동으로 미러 링크를 제공하세요",
  "api.gallery.invalidSource": "ouo.io 출처만 오케스트레이터 큐를 지원합니다. 현재 출처: {source}",
  "api.gallery.noZipData": "ZIP 다운로드 정보가 없습니다",
  "api.gallery.noProvider": "일치하는 사이트 제공자를 찾을 수 없습니다",
  "api.gallery.alreadyScraping": "이 갤러리는 다른 작업에서 스크랩 중입니다. 나중에 다시 시도하세요",
  "api.gallery.pageNotFound": "페이지를 찾을 수 없음 (404)",
  "api.gallery.pageNotFoundSkipped": "페이지를 찾을 수 없음 (404), 건너뜀",
  "api.gallery.identifying": "갤러리 식별 중입니다. 식별 완료 후 다운로드를 시작하세요",
  "api.gallery.scrapeComplete": "갤러리 스크랩 완료, 다운로드가 비동기로 시작되었습니다",
  "api.gallery.batchMissingUrls": "urls 매개변수는 비어있지 않은 배열이어야 합니다",
  "api.gallery.batchEmptyUrl": "빈 URL",
  "api.gallery.noProviderForRescrape": "갤러리 제공자를 찾을 수 없습니다, 다시 스크랩할 수 없습니다",

  // 작업
  "api.tasks.noM3u8Extracted": "페이지에서 M3U8 링크를 추출할 수 없습니다",

  // 차단 목록
  "api.blocklist.addFailed": "추가 실패",

  // 공통
  "api.characterDb.syncRunning": "동기화 작업이 실행 중입니다",
  "api.common.internalError": "서버 내부 오류",
  "api.common.missingParams": "필수 매개변수 누락: {params}",
};

export default koKR;
