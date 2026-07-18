import type { TranslationDict } from "../../types";

// 로그 메시지 템플릿 — 한국어
const koKR: TranslationDict = {
  // 안전 삭제
  "log.safeDelete.fileFailed": "파일 삭제 실패 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "파일 삭제 최종 실패: {path} — {msg}",
  "log.safeDelete.dirFailed": "디렉토리 삭제 실패 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "디렉토리 삭제 최종 실패: {path} — {msg}",

  // 갤러리 핸들러
  "log.galleryHandler.cancelledInQueue": "갤러리 #{id}이(가) 큐 대기 중 취소됨",
  "log.galleryHandler.cancelledInScrapeQueue": "갤러리 #{id}이(가) 스크랩 큐 대기 중 취소됨",
  "log.galleryHandler.domainRateLimited": "도메인 {url}이(가) {status} 반환 (속도 제한), 빠른 전환",
  "log.galleryHandler.asyncScrapeError": "갤러리 #{id} 비동기 스크랩 오류",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",
  "log.galleryHandler.downloadFailed": "Download failed: {msg}",
  "log.galleryHandler.downloadComplete": "Download complete: {success} succeeded, {failed} failed, {skipped} skipped",

  // SJS 사이트
  "log.sjs.noAccount": "사용 가능한 계정 없음, 게스트 모드로 접근 (전체 콘텐츠가 보이지 않을 수 있음)",
  "log.sjs.cookieInjected": "계정 #{id} Cookie 주입됨 ({count}개)",
  "log.sjs.cookieInjectionFailed": "Cookie 주입 실패, 재로그인 시도",
  "log.sjs.noCookieStartLogin": "유효한 Cookie 없음, 로그인 플로우 시작...",
  "log.sjs.loginSuccess": "계정 #{id} 로그인 성공, Cookie 저장됨 ({count}개)",
  "log.sjs.loginFailed": "로그인 실패",
  "log.sjs.paidContent": "유료 콘텐츠 게시글, 다운로드 링크를 보려면 구매해야 합니다",
  "log.sjs.detectedDownloadLinks": "다운로드 링크 {count}개 감지됨 (게시글 구매됨)",
  "log.sjs.pageNewImages": "게시글 {page}페이지: 새 이미지 (누적 {total})",
  "log.sjs.scrapePageFailed": "게시글 {page}페이지 스크랩 실패",
  "log.sjs.learnPersonFailed": "learnPerson 실패",
  "log.sjs.listPageNoResults": "목록 페이지 {page}: 결과 없음, 종료",
  "log.sjs.listPageNewResults": "목록 페이지 {page}: 새 결과 {count}개 (누적 {total})",
  "log.sjs.listPageNoNext": "목록 페이지에 다음 페이지 링크 없음, 종료",
  "log.sjs.navNextFailed": "다음 페이지 탐색 실패",
  "log.sjs.gotFormhash": "formhash 획득: {value}",
  "log.sjs.httpLoginSuccess": "HTTP 로그인 성공 (Cookie {count}개)",
  "log.sjs.signLink": "출석체크 링크: {href}",
  "log.sjs.postNotPurchased": "게시글 \"{title}\" 미구매, 구매 플로우 시작...",
  "log.sjs.buyFormParams": "구매 폼 매개변수: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "출석체크 시작: {username}",

  // 사이트 등록
  "log.siteRegistry.providerNotFound": "사이트 \"{id}\"의 Provider 구현을 찾을 수 없습니다",

  // 사이트 계정 관리
  "log.siteAccountManager.cookieSaved": "계정 #{id} Cookie 저장됨 ({count}개)",

  // ExHentai
  "log.exhentai.scrapePageFailed": "갤러리 {page}페이지 스크랩 실패",
  "log.exhentai.pageNewLinks": "갤러리 {page}페이지: 이미지 페이지 링크 {count}개 수집 (누적 {total})",
  "log.exhentai.batchFailed": "이미지 URL 일괄 가져오기 실패 (배치 {batch})",
  "log.exhentai.listPageNoResults": "목록 페이지 {page}: 결과 없음, 종료",
  "log.exhentai.listPageNewResults": "목록 페이지 {page}: 새 결과 {count}개 (누적 {total})",
  "log.exhentai.listPageNoNext": "목록 페이지에 다음 페이지 링크 없음, 종료",
  "log.exhentai.navNextFailed": "다음 페이지 탐색 실패",

  // 아이메이지
  "log.aimeizizi.learnPersonFailed": "learnPerson 실패",
  "log.aimeizizi.blockedSearchResult": "검색 결과 차단됨: \"{title}...\", 사유: {reason}",
  "log.aimeizizi.domainRateLimited": "{page}페이지 {status} 발생, 도메인 {domain}을(를) 속도 제한으로 표시",
  "log.aimeizizi.domainSwitchSuccess": "{page}페이지 도메인 {domain}(으)로 전환 성공",
  "log.aimeizizi.domainSwitchFailed": "{page}페이지 도메인 {domain} 실패: {msg}",
  "log.aimeizizi.scrapePageFailed": "{page}페이지 스크랩 실패 (도메인 {domain})",
  "log.aimeizizi.blockedGalleryScrape": "갤러리 스크랩 차단됨: \"{title}...\", 사유: {reason}",
  "log.aimeizizi.gameCharDetected": "게임 캐릭터 감지됨: {chars}",
  "log.aimeizizi.listPageFailed": "목록 페이지 {page} 스크랩 실패",

  // 공통 스크랩
  "log.scrape.capturedM3u8": "{url} — M3U8 URL {count}개 캡처: {urls}",

  // 캐릭터 서비스
  "log.protagonist.personCacheInitFailed": "Person 캐시 초기화 실패",

  // 검색 엔진
  "log.search.batchComplete": "일괄 스크랩 완료! 성공 {ok}, 실패 {fail}",
  "log.search.terminated": "Search task terminated abnormally: {msg}",
  "log.search.batchTerminated": "Batch search task terminated abnormally: {msg}",
  "log.taskCreator.downloadStartFailed": "Download task #{taskId} failed to start: {msg}",
  "log.parallelDL.writeFailed": "[ParallelDL] Write failed: {msg}",
  "log.parallelDL.requestFailed": "[ParallelDL] Request failed: {msg}",
  "log.downloadManager.segmentFailed": "  Segment #{idx}: {msg}",
  "log.downloadManager.incomplete": "Download incomplete: {failedCount} segments failed (out of {totalSegments} total)\n{details}",

  // 작업 큐 매니저
  "log.taskQueue.slotAllocated": "슬롯 할당됨: {key} (실행 중: 일반={normal}/{maxNormal}, 스니핑={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "슬롯 해제됨: {key} (실행 중: 일반={normal}/{maxNormal}, 스니핑={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "식별 슬롯 할당됨: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "식별 슬롯 해제됨: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "대기 중 작업 취소됨: {type}-{id}",
  "log.taskQueue.scrapingCancel": "대기 중 식별 작업 취소됨: {type}-{id}",
  "log.taskQueue.pendingGranted": "대기 중 작업 슬롯 획득: {key} (실행 중: 일반={normal}/{maxNormal}, 스니핑={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "대기 중 식별 작업 슬롯 획득: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "슬롯 가득 참, 작업 큐 대기: {key} (대기열 위치 {position})",
  "log.taskQueue.scrapingFull": "식별 슬롯 가득 참, 작업 큐 대기: {key} (대기열 위치 {position})",
  "log.taskQueue.configLoaded": "설정 로드됨: 일반 작업 한도={maxConcurrent}, 식별 중 한도={maxScraping}, 스니핑 작업 한도={maxSniff}, TS 세그먼트 동시={tsSegment}, 갤러리 이미지 동시={galleryImage}",
  "log.taskQueue.configUpdated": "설정 업데이트됨: 일반 작업 한도={maxConcurrent}, 식별 중 한도={maxScraping}, 스니핑 작업 한도={maxSniff}, TS 세그먼트 동시={tsSegment}, 갤러리 이미지 동시={galleryImage}",
  "log.taskQueue.configSeeded": "기본 설정이 데이터베이스에 시드됨: {keys}",
  "log.taskQueue.listenersRegistered": "EventBus 종료 상태 리스너 등록됨",
  "log.taskQueue.resetWarn": "카운터 강제 재설정됨",
"log.taskQueue.startupRecovery": "시작 복구: {count}개 작업 재대기열",
  "log.taskQueue.configLoadFailed": "설정 로드 실패, 기본값 사용: {error}",

  // 서버 라이프사이클
  "log.server.taskStateReset": "시작 시 작업 상태 재설정 완료",
  "log.server.downloadManagerInit": "다운로드 매니저 초기화됨",
  "log.server.eventBusBridgeInit": "EventBus 브리지 초기화됨",
  "log.server.ouoOrchestratorStart": "OUO 오케스트레이터 시작됨",

  // 작업 상태 재설정
  "log.taskStateReset.started": "실행 중 작업 상태 재설정 시작...",
  "log.taskStateReset.cleanupSlots": "잔여 슬롯 정리: 일반={normal}, 스니핑={sniff}, 식별={scraping}",
  "log.taskStateReset.completed": "재설정 완료: 동영상 {videoTasks}, 갤러리 {galleries}, 이미지 {galleryImages}, 동영상 {galleryVideos}, 스니핑 {sniffTasks}, ZIP 정보 {galleryDownloadInfos}, 총 {total}개 작업이 대기 상태로 재설정됨",
  "log.taskStateReset.noop": "실행 중인 작업이 없습니다. 재설정할 필요 없음",

  "log.seed.presetDataSeeded": "사전 설정 데이터를 데이터베이스에 작성했습니다: 사용자 기본설정 {prefs}개, 차단 목록 {blocklists}개",
};

export default koKR;
