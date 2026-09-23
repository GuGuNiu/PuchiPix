import type { TranslationDict } from "../../types";

const koKR: TranslationDict = {
  // Safe delete
  "log.safeDelete.fileFailed": "파일 삭제 실패 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "파일 삭제 최종 실패: {path} — {msg}",
  "log.safeDelete.dirFailed": "디렉토리 삭제 실패 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "디렉토리 삭제 최종 실패: {path} — {msg}",

  // Gallery handler
  "log.galleryHandler.cancelledInQueue": "갤러리 #{id} 대기열에서 취소됨",
  "log.galleryHandler.cancelledInScrapeQueue": "갤러리 #{id} 식별 대기열에서 취소됨",
  "log.galleryHandler.domainRateLimited": "도메인 {url}이(가) {status} 반환 (속도 제한), 빠른 전환",
  "log.galleryHandler.asyncScrapeError": "갤러리 #{id} 비동기 크롤링 오류",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",
  "log.galleryHandler.downloadFailed": "다운로드 실패: {msg}",
  "log.galleryHandler.downloadComplete": "다운로드 완료: 성공 {success}, 실패 {failed}, 건너뜀 {skipped}",

  // SJS site
  "log.sjs.noAccount": "사용 가능한 계정 없음, 게스트 모드로 접근 (전체 콘텐츠가 보이지 않을 수 있음)",
  "log.sjs.cookieInjected": "계정 #{id} Cookie 주입됨 ({count}개)",
  "log.sjs.cookieInjectionFailed": "Cookie 주입 실패, 재로그인 시도",
  "log.sjs.noCookieStartLogin": "유효한 Cookie 없음, 로그인 플로우 시작...",
  "log.sjs.loginSuccess": "계정 #{id} 로그인 성공, Cookie 저장됨 ({count}개)",
  "log.sjs.loginFailed": "로그인 실패",
  "log.sjs.paidContent": "유료 콘텐츠, 다운로드 링크를 보려면 구매 필요",
  "log.sjs.detectedDownloadLinks": "{count}개 다운로드 링크 감지됨 (게시글 구매됨)",
  "log.sjs.pageNewImages": "게시글 {page}페이지: 새 이미지 (누적 {total})",
  "log.sjs.scrapePageFailed": "게시글 {page}페이지 크롤링 실패",
  "log.sjs.learnPersonFailed": "learnPerson 실패",
  "log.sjs.listPageNoResults": "목록 페이지 {page}: 결과 없음, 종료",
  "log.sjs.listPageNewResults": "목록 페이지 {page}: 새 결과 {count}개 (누적 {total})",
  "log.sjs.listPageNoNext": "목록 페이지에 다음 페이지 링크 없음, 종료",
  "log.sjs.navNextFailed": "다음 페이지 탐색 실패",
  "log.sjs.gotFormhash": "formhash 획득: {value}",
  "log.sjs.httpLoginSuccess": "HTTP 로그인 성공 (Cookie {count}개)",
  "log.sjs.signLink": "출석 링크: {href}",
  "log.sjs.postNotPurchased": "게시글 \"{title}\" 미구매, 구매 플로우 시작...",
  "log.sjs.buyFormParams": "구매 폼 파라미터: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "출석 시작: {username}",

  // Site registry
  "log.siteRegistry.providerNotFound": "사이트 \"{id}\"의 Provider 구현을 찾을 수 없음",

  // Site account management
  "log.siteAccountManager.cookieSaved": "계정 #{id} Cookie 저장됨 ({count}개)",

  // ExHentai
  "log.exhentai.scrapePageFailed": "갤러리 {page}페이지 크롤링 실패",
  "log.exhentai.pageNewLinks": "갤러리 {page}페이지: 이미지 페이지 링크 {count}개 수집 (누적 {total})",
  "log.exhentai.batchFailed": "이미지 URL 배치 가져오기 실패 (배치 {batch})",
  "log.exhentai.listPageNoResults": "목록 페이지 {page}: 결과 없음, 종료",
  "log.exhentai.listPageNewResults": "목록 페이지 {page}: 새 결과 {count}개 (누적 {total})",
  "log.exhentai.listPageNoNext": "목록 페이지에 다음 페이지 링크 없음, 종료",
  "log.exhentai.navNextFailed": "다음 페이지 탐색 실패",

  // Aimeizizi
  "log.aimeizizi.learnPersonFailed": "learnPerson 실패",
  "log.aimeizizi.blockedSearchResult": "검색 결과 차단: \"{title}...\", 사유: {reason}",
  "log.aimeizizi.domainRateLimited": "{page}페이지 {status} 발생, 도메인 {domain}을(를) 속도 제한으로 표시",
  "log.aimeizizi.domainSwitchSuccess": "{page}페이지 도메인 {domain}(으)로 전환 성공",
  "log.aimeizizi.domainSwitchFailed": "{page}페이지 도메인 {domain} 실패: {msg}",
  "log.aimeizizi.scrapePageFailed": "{page}페이지 크롤링 실패 (도메인 {domain})",
  "log.aimeizizi.blockedGalleryScrape": "갤러리 크롤링 차단: \"{title}...\", 사유: {reason}",
  "log.aimeizizi.gameCharDetected": "게임 캐릭터 감지: {chars}",
  "log.aimeizizi.listPageFailed": "목록 페이지 {page} 크롤링 실패",

  // Common scraping
  "log.scrape.capturedM3u8": "{url} — M3U8 URL {count}개 캡처: {urls}",

  // Protagonist service
  "log.protagonist.personCacheInitFailed": "Person 캐시 초기화 실패",

  // Search engine
  "log.search.batchComplete": "배치 크롤링 완료! 성공 {ok}, 실패 {fail}",
  "log.search.terminated": "검색 작업 비정상 종료: {msg}",
  "log.search.batchTerminated": "배치 검색 작업 비정상 종료: {msg}",

  // Task creator
  "log.taskCreator.downloadStartFailed": "다운로드 작업 #{taskId} 시작 실패: {msg}",

  // Parallel downloader
  "log.parallelDL.writeFailed": "[ParallelDL] 쓰기 실패: {msg}",
  "log.parallelDL.requestFailed": "[ParallelDL] 요청 실패: {msg}",

  // Download manager
  "log.downloadManager.segmentFailed": "  세그먼트 #{idx}: {msg}",
  "log.downloadManager.incomplete": "다운로드 불완전: {failedCount}개 세그먼트 실패 (총 {totalSegments}개 중)\n{details}",

  // Task queue manager
  "log.taskQueue.slotAllocated": "슬롯 할당됨: {key} (실행 중: 일반={normal}/{maxNormal}, 탐색={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "슬롯 해제됨: {key} (실행 중: 일반={normal}/{maxNormal}, 탐색={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "식별 슬롯 할당됨: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "식별 슬롯 해제됨: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "대기 중 작업 취소됨: {type}-{id}",
  "log.taskQueue.scrapingCancel": "대기 중 식별 작업 취소됨: {type}-{id}",
  "log.taskQueue.pendingGranted": "대기 중 작업 슬롯 획득: {key} (실행 중: 일반={normal}/{maxNormal}, 탐색={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "대기 중 식별 작업 슬롯 획득: {key} (식별 중: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "슬롯 가득 참, 작업 대기열 추가: {key} (대기열 위치 {position})",
  "log.taskQueue.scrapingFull": "식별 슬롯 가득 참, 작업 대기열 추가: {key} (대기열 위치 {position})",
  "log.taskQueue.configLoaded": "설정 로드됨: 일반 작업 상한={maxConcurrent}, 식별 상한={maxScraping}, 탐색 작업 상한={maxSniff}, TS 세그먼트 동시={tsSegment}, 갤러리 이미지 동시={galleryImage}",
  "log.taskQueue.configUpdated": "설정 업데이트됨: 일반 작업 상한={maxConcurrent}, 식별 상한={maxScraping}, 탐색 작업 상한={maxSniff}, TS 세그먼트 동시={tsSegment}, 갤러리 이미지 동시={galleryImage}",
  "log.taskQueue.configSeeded": "기본 설정이 데이터베이스에 사전 기록됨: {keys}",
  "log.taskQueue.listenersRegistered": "EventBus 종료 상태 리스너 등록됨",
  "log.taskQueue.resetWarn": "카운터 강제 재설정됨",
  "log.taskQueue.startupRecovery": "시작 복구: {count}개 작업 재큐됨",
  "log.taskQueue.configLoadFailed": "설정 로드 실패, 기본값 사용: {error}",

  // Server lifecycle
  "log.server.taskStateReset": "시작 시 작업 상태 재설정 완료",
  "log.server.downloadManagerInit": "다운로드 관리자 초기화됨",
  "log.server.eventBusBridgeInit": "EventBus 브리지 초기화됨",
  "log.server.ouoOrchestratorStart": "OUO 오케스트레이터 시작됨",

  // Task state reset
  "log.taskStateReset.started": "실행 중 작업 상태 재설정 시작...",
  "log.taskStateReset.cleanupSlots": "잔여 슬롯 정리: 일반={normal}, 탐색={sniff}, 식별={scraping}",
  "log.taskStateReset.completed": "재설정 완료: 동영상 {videoTasks}, 갤러리 {galleries}, 이미지 {galleryImages}, 동영상 {galleryVideos}, 탐색 {sniffTasks}, ZIP 정보 {galleryDownloadInfos}, 총 {total}개 작업 대기 상태로 재설정됨",
  "log.taskStateReset.noop": "실행 중 작업 없음, 재설정 불필요",
  "log.taskStateReset.suspended": "서버 재시작, 작업 일시 중단됨",

  // Preset data seed
  "log.seed.presetDataSeeded": "사전 데이터가 데이터베이스에 기록됨: 사용자 설정 {prefs}개, 차단 단어 {blocklists}개",

  // DAG Orchestrator
  "log.dagOrchestrator.initComplete": "[DagOrchestrator] 초기화 완료",
  "log.dagOrchestrator.dagCompleted": "[DagOrchestrator] DAG {dagId} 전체 완료",
  "log.dagOrchestrator.dagEndedWithFailure": "[DagOrchestrator] DAG {dagId} 종료됨 (실패/취소 있음)",
  "log.dagOrchestrator.updateGalleryStatusFailed": "[DagOrchestrator] 갤러리 {galleryId} 상태 업데이트 실패",
  "log.dagOrchestrator.dagCancelled": "[DagOrchestrator] DAG {dagId} 취소됨",
  "log.dagOrchestrator.dagNotFoundCannotResume": "[DagOrchestrator] DAG {dagId}를 찾을 수 없어 재개 불가",
  "log.dagOrchestrator.resumeNodeFailedQueueFull": "[DagOrchestrator] 노드 {nodeId} 제출 실패, 대기열 가득 참, READY 상태 유지",
  "log.dagOrchestrator.dagResumeComplete": "[DagOrchestrator] DAG {dagId} 재개 완료: {resumedCount}/{totalCount}개 노드 재제출됨",
  "log.dagOrchestrator.restoreDag": "[DagOrchestrator] DAG {dagId} 복원 ({nodeCount}개 노드)",
  "log.dagOrchestrator.restartRecoveryComplete": "[DagOrchestrator] 재시작 복구 완료: {pausedCount}개 노드 일시정지됨, 사용자 수동 복구 대기",
  "log.dagOrchestrator.retryNodes": "[DagOrchestrator] DAG {dagId} {nodeCount}개 노드 재시도",
  "log.dagOrchestrator.dagSubmitted": "[DagOrchestrator] DAG {dagId} 제출됨 ({nodeCount}개 노드)",
  "log.dagOrchestrator.nodeSubmitFailedQueueFull": "[DagOrchestrator] 노드 {nodeId} 제출 실패, 대기열 가득 참, READY 상태 유지, 재시도 대기",
  "log.dagOrchestrator.nodeNotFoundCannotTransition": "[DagOrchestrator] 노드 {nodeId}를 찾을 수 없어 상태 전환 불가",

  // DAG Init
  "log.dagSystem.alreadyInitialized": "[DagSystem] 이미 초기화됨, 건너뜀",
  "log.dagSystem.initComplete": "[DagSystem] 초기화 완료 (기능 스위치: {status})",
  "log.dagSystem.initFailed": "[DagSystem] 초기화 실패",
  "log.dagSystem.timerStarted": "[DagSystem] 타이머 작업 시작됨",
  "log.dagSystem.stopped": "[DagSystem] 중지됨",
  "log.dagSystem.gracefulShutdownComplete": "[DagSystem] 우아한 종료 완료",

  // Orchestrator Base
  "log.orchestratorBase.alreadyRunning": "[{name}] 이미 실행 중, 건너뜀",
  "log.orchestratorBase.started": "[{name}] 오케스트레이터 시작됨",
  "log.orchestratorBase.stopping": "[{name}] 오케스트레이터 중지 중...",
  "log.orchestratorBase.waitingForTask": "[{name}] 현재 작업 #{taskId} 완료 대기 중...",
  "log.orchestratorBase.stopped": "[{name}] 오케스트레이터 중지됨",
  "log.orchestratorBase.paused": "[{name}] 오케스트레이터 일시정지됨",
  "log.orchestratorBase.resumed": "[{name}] 오케스트레이터 재개됨",
  "log.orchestratorBase.taskCancelled": "[{name}] 작업 취소됨 ID={id}",
  "log.orchestratorBase.queueCleared": "[{name}] 대기열 비워짐 (대기 중 작업 {count}개 제거)",
  "log.orchestratorBase.taskDependencyFailed": "[{name}] 종속성 실패로 작업 취소됨: ID={id}",
  "log.orchestratorBase.rateLimitWaiting": "[{name}] 속도 제한 쿨다운 중, {waitMs}s 후 계속...",
  "log.orchestratorBase.rateLimitResume": "[{name}] 속도 제한 쿨다운 종료, 대기열 처리 계속",
  "log.orchestratorBase.queueSummary": "[{name}] 대기열 상태 (총 처리 {total} 작업, 성공 {success}, 실패 {failed})",
  "log.orchestratorBase.startProcessing": "[{name}] 처리 시작: ID={taskId} ({count}번째 작업)",
  "log.orchestratorBase.taskSuccess": "[{name}] 작업 성공: ID={taskId}",
  "log.orchestratorBase.taskFailedRetry": "[{name}] 작업 실패, 재시도 예정 ({retryCount}회차): ID={taskId}, {waitSec}s 대기",
  "log.orchestratorBase.taskFailedExhausted": "[{name}] 작업 실패 (재시도 소진): ID={taskId}: {errorMsg}",
  "log.orchestratorBase.queueFullRejected": "[{name}] 대기열 가득 참 ({pending}/{max}), 큐 입력 거부: ID={id} (누적 거부 {rejected}회)",
  "log.orchestratorBase.taskEnqueued": "[{name}] 작업 큐 입력: ID={id}, 위치 {position} (대기열 {current}/{max})",
  "log.orchestratorBase.processingLoopError": "[{name}] 처리 루프 예외:",
  "log.orchestratorBase.taskFailedDefault": "작업 실패",
  "log.orchestratorBase.taskExceptionRetry": "[{name}] 작업 예외, 재시도 예정 ({retryCount}회차): ID={taskId}, {waitSec}s 대기",
  "log.orchestratorBase.taskExceptionExhausted": "[{name}] 작업 예외 (재시도 소진): ID={taskId}: {errorMsg}",
  "log.orchestratorBase.ipRateLimited": "IP 속도 제한",
  "log.orchestratorBase.rateLimitTriggered": "[{name}] 속도 제한 트리거: ID={id}, 쿨다운 {minutes}분",
  "log.orchestratorBase.cooldownResumeRequeue": "[{name}] 쿨다운 종료, 작업 재큐: ID={id} (재시도 {retryCount}회차)",
  "log.orchestratorBase.ipRateLimitExhausted": "IP 속도 제한 (재시도 소진)",
  "log.orchestratorBase.cooldownEndExhausted": "[{name}] 쿨다운 종료되었으나 재시도 소진: ID={id}",

  // DAG Config
  "log.dagConfig.schedulerToggle": "[DagConfig] DAG 스케줄러 {status}",
  "log.dagConfig.taskTypesUpdated": "[DagConfig] DAG 작업 유형 업데이트: [{value}]",
  "log.dagConfig.configLoadComplete": "[DagConfig] 설정 로드 완료: enabled={enabled}, taskTypes=[{taskTypes}]",
  "log.dagConfig.configLoadFailed": "[DagConfig] 설정 로드 실패:",
  "log.dagConfig.usingDefaultConfig": "[DagConfig] 기본 설정 사용: enabled=true (로드 실패 후 안전 강등)",
  "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] 갤러리 {galleryId} 오류 메시지 삭제 실패",
  "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId}를 찾을 수 없어 일시 중지할 수 없습니다",
  "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} 일시 중지됨 ({pausedCount} 노드)",
  "log.xsnvshen.ageVerifyError": "성인 인증 오류 (도메인: {domain}, 오류: {error})",
  "log.xsnvshen.ageVerifyFailed": "성인 인증 실패 (도메인: {domain}, 상태: {status})",
  "log.xsnvshen.ageVerifySuccess": "성인 인증 통과 (도메인: {domain})",
  "log.xsnvshen.blockedGalleryScrape": "갤러리 스크레이핑 차단: \"{title}...\"이유: {reason}",
  "log.xsnvshen.blockedSearchResult": "검색 결과 차단: \"{title}...\"이유: {reason}",
  "log.xsnvshen.gameCharDetected": "게임 캐릭터 감지: {chars}",
  "log.xsnvshen.httpFetchError": "HTTP 요청 실패 (도메인: {domain}, 오류: {error})",
  "log.xsnvshen.learnPersonFailed": "learnPerson 실패",
  "log.xsnvshen.listPageFailed": "목록 페이지 {page} 스크레이핑 실패",
};

export default koKR;
