"""
i18n 缺失 key 补齐脚本：为各语言文件插入缺失的翻译。
用法: python scripts/fill-missing-i18n.py
每个语言/模块的翻译定义在 TRANSLATIONS[lang][module] 中。
运行前请先备份（git）。
"""
import io, os, re, sys, json

LOCALES_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "i18n", "locales")
BACKEND_LOCALES = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "internal", "i18n", "locales")

# ------------------------------------------------------------
# 1. 从后端 zh-CN.json 提取缺失 key 的原文（参考）
# ------------------------------------------------------------
def load_backend_zh():
    p = os.path.join(BACKEND_LOCALES, "zh-CN.json")
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)

BACKEND_ZH = load_backend_zh()

# ------------------------------------------------------------
# 2. 解析 TS 文件中的 key -> value
# ------------------------------------------------------------
def parse_ts_keys(filepath):
    content = io.open(filepath, encoding="utf-8").read()
    entries = []
    regex = re.compile(r'"([A-Za-z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"')
    for m in regex.finditer(content):
        entries.append((m.group(1), m.group(2)))
    return content, dict(entries)

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

# ------------------------------------------------------------
# 3. 翻译定义 — TRANSLATIONS[lang][module][key] = "译文"
# ------------------------------------------------------------
TRANSLATIONS = {}

# 需要补齐的 key 集合（zh-CN 原文，用于生成 zh-TW 繁体）
API_MISSING = {
    "api.dag.schedulerRequired": "DAG 控制需要调度器（Phase 3）",
    "api.common.databaseUnavailable": "数据库不可用",
    "api.common.missingBody": "请求体不能为空",
    "api.common.invalidJson": "无效的 JSON 请求体",
    "api.common.endpointNotFound": "接口不存在",
    "api.common.methodNotAllowed": "方法不允许",
    "api.common.streamingNotSupported": "不支持流式传输",
    "api.common.invalidId": "无效的 ID",
    "api.common.keyRequired": "key 为必填项",
    "api.accounts.queryFailed": "查询账户失败",
    "api.accounts.missingFields": "siteId、username 和 password 为必填项",
    "api.accounts.createFailed": "创建账户失败",
    "api.accounts.updateFailed": "更新账户失败",
    "api.accounts.deleteFailed": "删除账户失败",
    "api.persons.queryFailed": "查询主角失败",
    "api.persons.missingName": "name 为必填项",
    "api.persons.createFailed": "创建主角失败",
    "api.persons.updateFailed": "更新主角失败",
    "api.persons.deleteFailed": "删除主角失败",
    "api.blocklist.queryFailed": "查询屏蔽规则失败",
    "api.blocklist.missingFields": "fieldType 和 keyword 为必填项",
    "api.blocklist.createFailed": "创建屏蔽规则失败",
    "api.blocklist.updateFailed": "更新屏蔽规则失败",
    "api.blocklist.deleteFailed": "删除屏蔽规则失败",
    "api.config.queryFailed": "查询配置失败",
    "api.config.updateFailed": "更新配置失败",
    "api.preferences.queryFailed": "查询用户偏好失败",
    "api.preferences.updateFailed": "更新用户偏好失败",
    "api.tasks.queryFailed": "查询任务失败",
    "api.tasks.missingUrl": "URL 为必填项",
    "api.tasks.createFailed": "创建任务失败",
    "api.tasks.invalidId": "无效的任务 ID",
    "api.tasks.notFound": "任务不存在",
    "api.tasks.schedulerRequired": "任务操作需要调度器（Phase 3）",
    "api.gallery.queryFailed": "查询图库失败",
    "api.gallery.invalidId": "无效的图库 ID",
    "api.gallery.queryImagesFailed": "查询图片失败",
    "api.history.queryFailed": "查询下载历史失败",
    "api.sjsShelf.queryFailed": "查询司机社收藏失败",
    "api.sjsShelf.missingUrlAndThreadId": "URL 和 threadId 为必填项",
    "api.sjsShelf.createFailed": "创建收藏失败",
    "api.sjsShelf.deleteFailed": "删除收藏失败",
    "api.sjsShelf.missingUrlParam": "URL 参数为必填项",
    "api.sjsShelf.missingGalleryId": "galleryId 为必填项",
}

LOG_MISSING = {
    "log.xsnvshen.ageVerifySuccess": "防沉迷验证通过 (域名: {domain})",
    "log.xsnvshen.ageVerifyFailed": "防沉迷验证失败 (域名: {domain}, 状态: {status})",
    "log.xsnvshen.ageVerifyError": "防沉迷验证异常 (域名: {domain}, 错误: {error})",
    "log.xsnvshen.httpFetchError": "HTTP 请求失败 (域名: {domain}, 错误: {error})",
    "log.xsnvshen.blockedSearchResult": "屏蔽搜索结果: \"{title}...\"原因: {reason}",
    "log.xsnvshen.blockedGalleryScrape": "屏蔽图库爬取: \"{title}...\"原因: {reason}",
    "log.xsnvshen.gameCharDetected": "识别到游戏角色: {chars}",
    "log.xsnvshen.learnPersonFailed": "learnPerson 失败",
    "log.xsnvshen.listPageFailed": "爬取列表页第 {page} 页失败",
    "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] 清除图库 {galleryId} 错误消息失败",
    "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} 已暂停 ({pausedCount} 个节点)",
    "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} 未找到无法暂停",
}

# ==================== zh-TW（繁体中文）====================
# 繁简转换辅助
def to_traditional(s):
    M = {
        "数": "數", "间": "間", "须": "須", "任务": "任務", "图": "圖", "库": "庫",
        "错误": "錯誤", "获取": "獲取", "失败": "失敗", "删除": "刪除", "账户": "帳戶",
        "更新": "更新", "创建": "創建", "查询": "查詢", "主角": "主角", "屏蔽": "屏蔽",
        "规则": "規則", "配置": "設定", "偏好": "偏好", "任务操作": "任務操作",
        "调度器": "調度器", "数据库": "資料庫", "请求": "請求", "无效": "無效",
        "接口": "介面", "存在": "存在", "方法": "方法", "允许": "允許", "支持": "支援",
        "流式": "串流", "传输": "傳輸", "必填": "必填", "项": "項", "历史": "歷史",
        "下载": "下載", "司机社": "司機社", "收藏": "收藏", "参数": "參數",
        "防沉迷": "防沉迷", "验证": "驗證", "通过": "通過", "域名": "域名", "状态": "狀態",
        "异常": "異常", "识别": "識別", "角色": "角色", "列表页": "列表頁", "爬取": "爬取",
        "页": "頁", "清除": "清除", "消息": "訊息", "节点": "節點", "暂停": "暫停",
        "无法": "無法", "恢复": "恢復", "用户": "使用者", "图片": "圖片", "已经": "已經",
    }
    for k, v in M.items():
        s = s.replace(k, v)
    return s

tw_api = {}
for k, zh in API_MISSING.items():
    tw_api[k] = to_traditional(zh)
tw_log = {}
for k, zh in LOG_MISSING.items():
    tw_log[k] = to_traditional(zh)

TRANSLATIONS["zh-TW"] = {"api": tw_api, "log": tw_log}

# ==================== en-US（英语）====================
TRANSLATIONS["en-US"] = {
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Anti-addiction verification passed (domain: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Anti-addiction verification failed (domain: {domain}, status: {status})",
        "log.xsnvshen.ageVerifyError": "Anti-addiction verification error (domain: {domain}, error: {error})",
        "log.xsnvshen.httpFetchError": "HTTP request failed (domain: {domain}, error: {error})",
        "log.xsnvshen.blockedSearchResult": "Blocked search result: \"{title}...\", reason: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Blocked gallery scrape: \"{title}...\", reason: {reason}",
        "log.xsnvshen.gameCharDetected": "Detected game characters: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson failed",
        "log.xsnvshen.listPageFailed": "Failed to scrape list page {page}",
    },
}

# ==================== ja-JP（日语）====================
TRANSLATIONS["ja-JP"] = {
    "api": {
        "api.dag.schedulerRequired": "DAG の制御にはスケジューラーが必要です（Phase 3）",
        "api.common.databaseUnavailable": "データベースを利用できません",
        "api.common.missingBody": "リクエストボディが空です",
        "api.common.invalidJson": "無効な JSON リクエストボディ",
        "api.common.endpointNotFound": "エンドポイントが見つかりません",
        "api.common.methodNotAllowed": "許可されていないメソッドです",
        "api.common.streamingNotSupported": "ストリーミングはサポートされていません",
        "api.common.invalidId": "無効な ID",
        "api.common.keyRequired": "key は必須です",
        "api.accounts.queryFailed": "アカウントの照会に失敗しました",
        "api.accounts.missingFields": "siteId、username、password は必須です",
        "api.accounts.createFailed": "アカウントの作成に失敗しました",
        "api.accounts.updateFailed": "アカウントの更新に失敗しました",
        "api.accounts.deleteFailed": "アカウントの削除に失敗しました",
        "api.persons.queryFailed": "主演の照会に失敗しました",
        "api.persons.missingName": "name は必須です",
        "api.persons.createFailed": "主演の作成に失敗しました",
        "api.persons.updateFailed": "主演の更新に失敗しました",
        "api.persons.deleteFailed": "主演の削除に失敗しました",
        "api.blocklist.queryFailed": "ブロックルールの照会に失敗しました",
        "api.blocklist.missingFields": "fieldType と keyword は必須です",
        "api.blocklist.createFailed": "ブロックルールの作成に失敗しました",
        "api.blocklist.updateFailed": "ブロックルールの更新に失敗しました",
        "api.blocklist.deleteFailed": "ブロックルールの削除に失敗しました",
        "api.config.queryFailed": "設定の照会に失敗しました",
        "api.config.updateFailed": "設定の更新に失敗しました",
        "api.preferences.queryFailed": "ユーザー設定の照会に失敗しました",
        "api.preferences.updateFailed": "ユーザー設定の更新に失敗しました",
        "api.tasks.queryFailed": "タスクの照会に失敗しました",
        "api.tasks.missingUrl": "URL は必須です",
        "api.tasks.createFailed": "タスクの作成に失敗しました",
        "api.tasks.invalidId": "無効なタスク ID",
        "api.tasks.notFound": "タスクが見つかりません",
        "api.tasks.schedulerRequired": "タスク操作にはスケジューラーが必要です（Phase 3）",
        "api.gallery.queryFailed": "ギャラリーの照会に失敗しました",
        "api.gallery.invalidId": "無効なギャラリー ID",
        "api.gallery.queryImagesFailed": "画像の照会に失敗しました",
        "api.history.queryFailed": "ダウンロード履歴の照会に失敗しました",
        "api.sjsShelf.queryFailed": "SJS ブックマークの照会に失敗しました",
        "api.sjsShelf.missingUrlAndThreadId": "URL と threadId は必須です",
        "api.sjsShelf.createFailed": "ブックマークの作成に失敗しました",
        "api.sjsShelf.deleteFailed": "ブックマークの削除に失敗しました",
        "api.sjsShelf.missingUrlParam": "URL パラメータは必須です",
        "api.sjsShelf.missingGalleryId": "galleryId は必須です",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "年齢認証に成功しました（ドメイン: {domain}）",
        "log.xsnvshen.ageVerifyFailed": "年齢認証に失敗しました（ドメイン: {domain}, 状態: {status}）",
        "log.xsnvshen.ageVerifyError": "年齢認証エラー（ドメイン: {domain}, エラー: {error}）",
        "log.xsnvshen.httpFetchError": "HTTP リクエストに失敗しました（ドメイン: {domain}, エラー: {error}）",
        "log.xsnvshen.blockedSearchResult": "検索結果をブロック: \"{title}...\"理由: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "ギャラリーのスクレイピングをブロック: \"{title}...\"理由: {reason}",
        "log.xsnvshen.gameCharDetected": "ゲームキャラクターを検出: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson に失敗しました",
        "log.xsnvshen.listPageFailed": "リストページ {page} のスクレイピングに失敗しました",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] ギャラリー {galleryId} のエラーメッセージのクリアに失敗しました",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} を一時停止しました（{pausedCount} ノード）",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} が見つからないため一時停止できません",
    },
}

# ==================== ko-KR（韩语）====================
TRANSLATIONS["ko-KR"] = {
    "api": {
        "api.dag.schedulerRequired": "DAG 제어에는 스케줄러가 필요합니다 (Phase 3)",
        "api.common.databaseUnavailable": "데이터베이스를 사용할 수 없습니다",
        "api.common.missingBody": "요청 본문이 비어 있습니다",
        "api.common.invalidJson": "잘못된 JSON 요청 본문",
        "api.common.endpointNotFound": "엔드포인트가 존재하지 않습니다",
        "api.common.methodNotAllowed": "허용되지 않는 메서드입니다",
        "api.common.streamingNotSupported": "스트리밍을 지원하지 않습니다",
        "api.common.invalidId": "잘못된 ID",
        "api.common.keyRequired": "key는 필수입니다",
        "api.accounts.queryFailed": "계정 조회에 실패했습니다",
        "api.accounts.missingFields": "siteId, username, password는 필수입니다",
        "api.accounts.createFailed": "계정 생성에 실패했습니다",
        "api.accounts.updateFailed": "계정 업데이트에 실패했습니다",
        "api.accounts.deleteFailed": "계정 삭제에 실패했습니다",
        "api.persons.queryFailed": "주연 조회에 실패했습니다",
        "api.persons.missingName": "name은 필수입니다",
        "api.persons.createFailed": "주연 생성에 실패했습니다",
        "api.persons.updateFailed": "주연 업데이트에 실패했습니다",
        "api.persons.deleteFailed": "주연 삭제에 실패했습니다",
        "api.blocklist.queryFailed": "차단 규칙 조회에 실패했습니다",
        "api.blocklist.missingFields": "fieldType과 keyword는 필수입니다",
        "api.blocklist.createFailed": "차단 규칙 생성에 실패했습니다",
        "api.blocklist.updateFailed": "차단 규칙 업데이트에 실패했습니다",
        "api.blocklist.deleteFailed": "차단 규칙 삭제에 실패했습니다",
        "api.config.queryFailed": "구성 조회에 실패했습니다",
        "api.config.updateFailed": "구성 업데이트에 실패했습니다",
        "api.preferences.queryFailed": "사용자 기본 설정 조회에 실패했습니다",
        "api.preferences.updateFailed": "사용자 기본 설정 업데이트에 실패했습니다",
        "api.tasks.queryFailed": "작업 조회에 실패했습니다",
        "api.tasks.missingUrl": "URL은 필수입니다",
        "api.tasks.createFailed": "작업 생성에 실패했습니다",
        "api.tasks.invalidId": "잘못된 작업 ID",
        "api.tasks.notFound": "작업을 찾을 수 없습니다",
        "api.tasks.schedulerRequired": "작업 조작에는 스케줄러가 필요합니다 (Phase 3)",
        "api.gallery.queryFailed": "갤러리 조회에 실패했습니다",
        "api.gallery.invalidId": "잘못된 갤러리 ID",
        "api.gallery.queryImagesFailed": "이미지 조회에 실패했습니다",
        "api.history.queryFailed": "다운로드 기록 조회에 실패했습니다",
        "api.sjsShelf.queryFailed": "SJS 북마크 조회에 실패했습니다",
        "api.sjsShelf.missingUrlAndThreadId": "URL과 threadId는 필수입니다",
        "api.sjsShelf.createFailed": "북마크 생성에 실패했습니다",
        "api.sjsShelf.deleteFailed": "북마크 삭제에 실패했습니다",
        "api.sjsShelf.missingUrlParam": "URL 매개변수는 필수입니다",
        "api.sjsShelf.missingGalleryId": "galleryId는 필수입니다",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "성인 인증 통과 (도메인: {domain})",
        "log.xsnvshen.ageVerifyFailed": "성인 인증 실패 (도메인: {domain}, 상태: {status})",
        "log.xsnvshen.ageVerifyError": "성인 인증 오류 (도메인: {domain}, 오류: {error})",
        "log.xsnvshen.httpFetchError": "HTTP 요청 실패 (도메인: {domain}, 오류: {error})",
        "log.xsnvshen.blockedSearchResult": "검색 결과 차단: \"{title}...\"이유: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "갤러리 스크레이핑 차단: \"{title}...\"이유: {reason}",
        "log.xsnvshen.gameCharDetected": "게임 캐릭터 감지: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson 실패",
        "log.xsnvshen.listPageFailed": "목록 페이지 {page} 스크레이핑 실패",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] 갤러리 {galleryId} 오류 메시지 삭제 실패",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} 일시 중지됨 ({pausedCount} 노드)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId}를 찾을 수 없어 일시 중지할 수 없습니다",
    },
}

# ==================== ru-RU（俄语）====================
TRANSLATIONS["ru-RU"] = {
    "api": {
        "api.dag.schedulerRequired": "Для управления DAG требуется планировщик (Phase 3)",
        "api.common.databaseUnavailable": "База данных недоступна",
        "api.common.missingBody": "Тело запроса не может быть пустым",
        "api.common.invalidJson": "Недопустимое тело JSON-запроса",
        "api.common.endpointNotFound": "Конечная точка не найдена",
        "api.common.methodNotAllowed": "Метод не разрешён",
        "api.common.streamingNotSupported": "Потоковая передача не поддерживается",
        "api.common.invalidId": "Недопустимый ID",
        "api.common.keyRequired": "Параметр key обязателен",
        "api.accounts.queryFailed": "Не удалось запросить аккаунты",
        "api.accounts.missingFields": "siteId, username и password обязательны",
        "api.accounts.createFailed": "Не удалось создать аккаунт",
        "api.accounts.updateFailed": "Не удалось обновить аккаунт",
        "api.accounts.deleteFailed": "Не удалось удалить аккаунт",
        "api.persons.queryFailed": "Не удалось запросить исполнителей",
        "api.persons.missingName": "Параметр name обязателен",
        "api.persons.createFailed": "Не удалось создать исполнителя",
        "api.persons.updateFailed": "Не удалось обновить исполнителя",
        "api.persons.deleteFailed": "Не удалось удалить исполнителя",
        "api.blocklist.queryFailed": "Не удалось запросить правила блокировки",
        "api.blocklist.missingFields": "fieldType и keyword обязательны",
        "api.blocklist.createFailed": "Не удалось создать правило блокировки",
        "api.blocklist.updateFailed": "Не удалось обновить правило блокировки",
        "api.blocklist.deleteFailed": "Не удалось удалить правило блокировки",
        "api.config.queryFailed": "Не удалось запросить конфигурацию",
        "api.config.updateFailed": "Не удалось обновить конфигурацию",
        "api.preferences.queryFailed": "Не удалось запросить настройки пользователя",
        "api.preferences.updateFailed": "Не удалось обновить настройки пользователя",
        "api.tasks.queryFailed": "Не удалось запросить задачи",
        "api.tasks.missingUrl": "URL обязателен",
        "api.tasks.createFailed": "Не удалось создать задачу",
        "api.tasks.invalidId": "Недопустимый ID задачи",
        "api.tasks.notFound": "Задача не найдена",
        "api.tasks.schedulerRequired": "Для операций с задачами требуется планировщик (Phase 3)",
        "api.gallery.queryFailed": "Не удалось запросить галереи",
        "api.gallery.invalidId": "Недопустимый ID галереи",
        "api.gallery.queryImagesFailed": "Не удалось запросить изображения",
        "api.history.queryFailed": "Не удалось запросить историю загрузок",
        "api.sjsShelf.queryFailed": "Не удалось запросить закладки SJS",
        "api.sjsShelf.missingUrlAndThreadId": "URL и threadId обязательны",
        "api.sjsShelf.createFailed": "Не удалось создать закладку",
        "api.sjsShelf.deleteFailed": "Не удалось удалить закладку",
        "api.sjsShelf.missingUrlParam": "Параметр URL обязателен",
        "api.sjsShelf.missingGalleryId": "Параметр galleryId обязателен",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Проверка возраста пройдена (домен: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Проверка возраста не пройдена (домен: {domain}, статус: {status})",
        "log.xsnvshen.ageVerifyError": "Ошибка проверки возраста (домен: {domain}, ошибка: {error})",
        "log.xsnvshen.httpFetchError": "Сбой HTTP-запроса (домен: {domain}, ошибка: {error})",
        "log.xsnvshen.blockedSearchResult": "Заблокирован результат поиска: \"{title}...\"причина: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Заблокировано сканирование галереи: \"{title}...\"причина: {reason}",
        "log.xsnvshen.gameCharDetected": "Обнаружены игровые персонажи: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson не удалось",
        "log.xsnvshen.listPageFailed": "Не удалось обработать страницу списка {page}",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Не удалось очистить сообщение об ошибке галереи {galleryId}",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} приостановлен ({pausedCount} узлов)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} не найден, невозможно приостановить",
    },
}

# ==================== de-DE（德语）====================
TRANSLATIONS["de-DE"] = {
    "api": {
        "api.dag.schedulerRequired": "DAG-Steuerung erfordert Scheduler (Phase 3)",
        "api.common.databaseUnavailable": "Datenbank nicht verfügbar",
        "api.common.missingBody": "Anfragebody darf nicht leer sein",
        "api.common.invalidJson": "Ungültiger JSON-Anfragebody",
        "api.common.endpointNotFound": "Endpunkt nicht gefunden",
        "api.common.methodNotAllowed": "Methode nicht erlaubt",
        "api.common.streamingNotSupported": "Streaming wird nicht unterstützt",
        "api.common.invalidId": "Ungültige ID",
        "api.common.keyRequired": "Parameter key ist erforderlich",
        "api.accounts.queryFailed": "Abfrage der Konten fehlgeschlagen",
        "api.accounts.missingFields": "siteId, username und password sind erforderlich",
        "api.accounts.createFailed": "Erstellen des Kontos fehlgeschlagen",
        "api.accounts.updateFailed": "Aktualisieren des Kontos fehlgeschlagen",
        "api.accounts.deleteFailed": "Löschen des Kontos fehlgeschlagen",
        "api.persons.queryFailed": "Abfrage der Darsteller fehlgeschlagen",
        "api.persons.missingName": "Parameter name ist erforderlich",
        "api.persons.createFailed": "Erstellen des Darstellers fehlgeschlagen",
        "api.persons.updateFailed": "Aktualisieren des Darstellers fehlgeschlagen",
        "api.persons.deleteFailed": "Löschen des Darstellers fehlgeschlagen",
        "api.blocklist.queryFailed": "Abfrage der Sperrregeln fehlgeschlagen",
        "api.blocklist.missingFields": "fieldType und keyword sind erforderlich",
        "api.blocklist.createFailed": "Erstellen der Sperrregel fehlgeschlagen",
        "api.blocklist.updateFailed": "Aktualisieren der Sperrregel fehlgeschlagen",
        "api.blocklist.deleteFailed": "Löschen der Sperrregel fehlgeschlagen",
        "api.config.queryFailed": "Abfrage der Konfiguration fehlgeschlagen",
        "api.config.updateFailed": "Aktualisieren der Konfiguration fehlgeschlagen",
        "api.preferences.queryFailed": "Abfrage der Benutzereinstellungen fehlgeschlagen",
        "api.preferences.updateFailed": "Aktualisieren der Benutzereinstellungen fehlgeschlagen",
        "api.tasks.queryFailed": "Abfrage der Aufgaben fehlgeschlagen",
        "api.tasks.missingUrl": "URL ist erforderlich",
        "api.tasks.createFailed": "Erstellen der Aufgabe fehlgeschlagen",
        "api.tasks.invalidId": "Ungültige Aufgaben-ID",
        "api.tasks.notFound": "Aufgabe nicht gefunden",
        "api.tasks.schedulerRequired": "Aufgabenoperationen erfordern Scheduler (Phase 3)",
        "api.gallery.queryFailed": "Abfrage der Galerien fehlgeschlagen",
        "api.gallery.invalidId": "Ungültige Galerie-ID",
        "api.gallery.queryImagesFailed": "Abfrage der Bilder fehlgeschlagen",
        "api.history.queryFailed": "Abfrage des Downloadverlaufs fehlgeschlagen",
        "api.sjsShelf.queryFailed": "Abfrage der SJS-Lesezeichen fehlgeschlagen",
        "api.sjsShelf.missingUrlAndThreadId": "URL und threadId sind erforderlich",
        "api.sjsShelf.createFailed": "Erstellen des Lesezeichens fehlgeschlagen",
        "api.sjsShelf.deleteFailed": "Löschen des Lesezeichens fehlgeschlagen",
        "api.sjsShelf.missingUrlParam": "URL-Parameter ist erforderlich",
        "api.sjsShelf.missingGalleryId": "Parameter galleryId ist erforderlich",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Altersverifizierung bestanden (Domäne: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Altersverifizierung fehlgeschlagen (Domäne: {domain}, Status: {status})",
        "log.xsnvshen.ageVerifyError": "Fehler bei der Altersverifizierung (Domäne: {domain}, Fehler: {error})",
        "log.xsnvshen.httpFetchError": "HTTP-Anfrage fehlgeschlagen (Domäne: {domain}, Fehler: {error})",
        "log.xsnvshen.blockedSearchResult": "Suchergebnis blockiert: \"{title}...\"Grund: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Galerie-Scraping blockiert: \"{title}...\"Grund: {reason}",
        "log.xsnvshen.gameCharDetected": "Spielcharaktere erkannt: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson fehlgeschlagen",
        "log.xsnvshen.listPageFailed": "Scraping der Listenseite {page} fehlgeschlagen",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Fehlermeldung der Galerie {galleryId} konnte nicht gelöscht werden",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} pausiert ({pausedCount} Knoten)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} nicht gefunden, Pausieren nicht möglich",
    },
}

# ==================== vi-VN（越南语）====================
TRANSLATIONS["vi-VN"] = {
    "api": {
        "api.dag.schedulerRequired": "Điều khiển DAG yêu cầu trình lập lịch (Phase 3)",
        "api.common.databaseUnavailable": "Cơ sở dữ liệu không khả dụng",
        "api.common.missingBody": "Nội dung yêu cầu không được để trống",
        "api.common.invalidJson": "Nội dung JSON yêu cầu không hợp lệ",
        "api.common.endpointNotFound": "Không tìm thấy điểm cuối",
        "api.common.methodNotAllowed": "Phương thức không được phép",
        "api.common.streamingNotSupported": "Không hỗ trợ truyền phát",
        "api.common.invalidId": "ID không hợp lệ",
        "api.common.keyRequired": "Tham số key là bắt buộc",
        "api.accounts.queryFailed": "Truy vấn tài khoản thất bại",
        "api.accounts.missingFields": "siteId, username và password là bắt buộc",
        "api.accounts.createFailed": "Tạo tài khoản thất bại",
        "api.accounts.updateFailed": "Cập nhật tài khoản thất bại",
        "api.accounts.deleteFailed": "Xóa tài khoản thất bại",
        "api.persons.queryFailed": "Truy vấn diễn viên thất bại",
        "api.persons.missingName": "Tham số name là bắt buộc",
        "api.persons.createFailed": "Tạo diễn viên thất bại",
        "api.persons.updateFailed": "Cập nhật diễn viên thất bại",
        "api.persons.deleteFailed": "Xóa diễn viên thất bại",
        "api.blocklist.queryFailed": "Truy vấn quy tắc chặn thất bại",
        "api.blocklist.missingFields": "fieldType và keyword là bắt buộc",
        "api.blocklist.createFailed": "Tạo quy tắc chặn thất bại",
        "api.blocklist.updateFailed": "Cập nhật quy tắc chặn thất bại",
        "api.blocklist.deleteFailed": "Xóa quy tắc chặn thất bại",
        "api.config.queryFailed": "Truy vấn cấu hình thất bại",
        "api.config.updateFailed": "Cập nhật cấu hình thất bại",
        "api.preferences.queryFailed": "Truy vấn tùy chọn người dùng thất bại",
        "api.preferences.updateFailed": "Cập nhật tùy chọn người dùng thất bại",
        "api.tasks.queryFailed": "Truy vấn tác vụ thất bại",
        "api.tasks.missingUrl": "URL là bắt buộc",
        "api.tasks.createFailed": "Tạo tác vụ thất bại",
        "api.tasks.invalidId": "ID tác vụ không hợp lệ",
        "api.tasks.notFound": "Không tìm thấy tác vụ",
        "api.tasks.schedulerRequired": "Thao tác tác vụ yêu cầu trình lập lịch (Phase 3)",
        "api.gallery.queryFailed": "Truy vấn bộ sưu tập thất bại",
        "api.gallery.invalidId": "ID bộ sưu tập không hợp lệ",
        "api.gallery.queryImagesFailed": "Truy vấn hình ảnh thất bại",
        "api.history.queryFailed": "Truy vấn lịch sử tải xuống thất bại",
        "api.sjsShelf.queryFailed": "Truy vấn dấu trang SJS thất bại",
        "api.sjsShelf.missingUrlAndThreadId": "URL và threadId là bắt buộc",
        "api.sjsShelf.createFailed": "Tạo dấu trang thất bại",
        "api.sjsShelf.deleteFailed": "Xóa dấu trang thất bại",
        "api.sjsShelf.missingUrlParam": "Tham số URL là bắt buộc",
        "api.sjsShelf.missingGalleryId": "Tham số galleryId là bắt buộc",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Xác minh độ tuổi thành công (miền: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Xác minh độ tuổi thất bại (miền: {domain}, trạng thái: {status})",
        "log.xsnvshen.ageVerifyError": "Lỗi xác minh độ tuổi (miền: {domain}, lỗi: {error})",
        "log.xsnvshen.httpFetchError": "Yêu cầu HTTP thất bại (miền: {domain}, lỗi: {error})",
        "log.xsnvshen.blockedSearchResult": "Đã chặn kết quả tìm kiếm: \"{title}...\"lý do: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Đã chặn thu thập bộ sưu tập: \"{title}...\"lý do: {reason}",
        "log.xsnvshen.gameCharDetected": "Đã phát hiện nhân vật trò chơi: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson thất bại",
        "log.xsnvshen.listPageFailed": "Thu thập trang danh sách {page} thất bại",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Xóa thông báo lỗi bộ sưu tập {galleryId} thất bại",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} đã tạm dừng ({pausedCount} nút)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] Không tìm thấy DAG {dagId}, không thể tạm dừng",
    },
}

# ==================== es-ES（西班牙语）====================
TRANSLATIONS["es-ES"] = {
    "api": {
        "api.dag.schedulerRequired": "El control de DAG requiere programador (Phase 3)",
        "api.common.databaseUnavailable": "Base de datos no disponible",
        "api.common.missingBody": "El cuerpo de la solicitud no puede estar vacío",
        "api.common.invalidJson": "Cuerpo JSON de solicitud no válido",
        "api.common.endpointNotFound": "Punto final no encontrado",
        "api.common.methodNotAllowed": "Método no permitido",
        "api.common.streamingNotSupported": "Transmisión no admitida",
        "api.common.invalidId": "ID no válido",
        "api.common.keyRequired": "El parámetro key es obligatorio",
        "api.accounts.queryFailed": "Error al consultar cuentas",
        "api.accounts.missingFields": "siteId, username y password son obligatorios",
        "api.accounts.createFailed": "Error al crear cuenta",
        "api.accounts.updateFailed": "Error al actualizar cuenta",
        "api.accounts.deleteFailed": "Error al eliminar cuenta",
        "api.persons.queryFailed": "Error al consultar protagonistas",
        "api.persons.missingName": "El parámetro name es obligatorio",
        "api.persons.createFailed": "Error al crear protagonista",
        "api.persons.updateFailed": "Error al actualizar protagonista",
        "api.persons.deleteFailed": "Error al eliminar protagonista",
        "api.blocklist.queryFailed": "Error al consultar reglas de bloqueo",
        "api.blocklist.missingFields": "fieldType y keyword son obligatorios",
        "api.blocklist.createFailed": "Error al crear regla de bloqueo",
        "api.blocklist.updateFailed": "Error al actualizar regla de bloqueo",
        "api.blocklist.deleteFailed": "Error al eliminar regla de bloqueo",
        "api.config.queryFailed": "Error al consultar configuración",
        "api.config.updateFailed": "Error al actualizar configuración",
        "api.preferences.queryFailed": "Error al consultar preferencias del usuario",
        "api.preferences.updateFailed": "Error al actualizar preferencias del usuario",
        "api.tasks.queryFailed": "Error al consultar tareas",
        "api.tasks.missingUrl": "La URL es obligatoria",
        "api.tasks.createFailed": "Error al crear tarea",
        "api.tasks.invalidId": "ID de tarea no válido",
        "api.tasks.notFound": "Tarea no encontrada",
        "api.tasks.schedulerRequired": "Las operaciones de tarea requieren programador (Phase 3)",
        "api.gallery.queryFailed": "Error al consultar galerías",
        "api.gallery.invalidId": "ID de galería no válido",
        "api.gallery.queryImagesFailed": "Error al consultar imágenes",
        "api.history.queryFailed": "Error al consultar historial de descargas",
        "api.sjsShelf.queryFailed": "Error al consultar marcadores SJS",
        "api.sjsShelf.missingUrlAndThreadId": "URL y threadId son obligatorios",
        "api.sjsShelf.createFailed": "Error al crear marcador",
        "api.sjsShelf.deleteFailed": "Error al eliminar marcador",
        "api.sjsShelf.missingUrlParam": "El parámetro URL es obligatorio",
        "api.sjsShelf.missingGalleryId": "El parámetro galleryId es obligatorio",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Verificación de edad superada (dominio: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Verificación de edad fallida (dominio: {domain}, estado: {status})",
        "log.xsnvshen.ageVerifyError": "Error de verificación de edad (dominio: {domain}, error: {error})",
        "log.xsnvshen.httpFetchError": "Solicitud HTTP fallida (dominio: {domain}, error: {error})",
        "log.xsnvshen.blockedSearchResult": "Resultado de búsqueda bloqueado: \"{title}...\"motivo: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Extracción de galería bloqueada: \"{title}...\"motivo: {reason}",
        "log.xsnvshen.gameCharDetected": "Personajes de juego detectados: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson falló",
        "log.xsnvshen.listPageFailed": "Error al extraer la página de lista {page}",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Error al borrar mensaje de error de la galería {galleryId}",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} pausado ({pausedCount} nodos)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} no encontrado, no se puede pausar",
    },
}

# ==================== pt-BR（巴西葡萄牙语）====================
TRANSLATIONS["pt-BR"] = {
    "api": {
        "api.dag.schedulerRequired": "O controle de DAG requer agendador (Phase 3)",
        "api.common.databaseUnavailable": "Banco de dados indisponível",
        "api.common.missingBody": "O corpo da solicitação não pode estar vazio",
        "api.common.invalidJson": "Corpo JSON de solicitação inválido",
        "api.common.endpointNotFound": "Endpoint não encontrado",
        "api.common.methodNotAllowed": "Método não permitido",
        "api.common.streamingNotSupported": "Streaming não suportado",
        "api.common.invalidId": "ID inválido",
        "api.common.keyRequired": "O parâmetro key é obrigatório",
        "api.accounts.queryFailed": "Falha ao consultar contas",
        "api.accounts.missingFields": "siteId, username e password são obrigatórios",
        "api.accounts.createFailed": "Falha ao criar conta",
        "api.accounts.updateFailed": "Falha ao atualizar conta",
        "api.accounts.deleteFailed": "Falha ao excluir conta",
        "api.persons.queryFailed": "Falha ao consultar protagonistas",
        "api.persons.missingName": "O parâmetro name é obrigatório",
        "api.persons.createFailed": "Falha ao criar protagonista",
        "api.persons.updateFailed": "Falha ao atualizar protagonista",
        "api.persons.deleteFailed": "Falha ao excluir protagonista",
        "api.blocklist.queryFailed": "Falha ao consultar regras de bloqueio",
        "api.blocklist.missingFields": "fieldType e keyword são obrigatórios",
        "api.blocklist.createFailed": "Falha ao criar regra de bloqueio",
        "api.blocklist.updateFailed": "Falha ao atualizar regra de bloqueio",
        "api.blocklist.deleteFailed": "Falha ao excluir regra de bloqueio",
        "api.config.queryFailed": "Falha ao consultar configuração",
        "api.config.updateFailed": "Falha ao atualizar configuração",
        "api.preferences.queryFailed": "Falha ao consultar preferências do usuário",
        "api.preferences.updateFailed": "Falha ao atualizar preferências do usuário",
        "api.tasks.queryFailed": "Falha ao consultar tarefas",
        "api.tasks.missingUrl": "URL é obrigatória",
        "api.tasks.createFailed": "Falha ao criar tarefa",
        "api.tasks.invalidId": "ID de tarefa inválido",
        "api.tasks.notFound": "Tarefa não encontrada",
        "api.tasks.schedulerRequired": "Operações de tarefa requerem agendador (Phase 3)",
        "api.gallery.queryFailed": "Falha ao consultar galerias",
        "api.gallery.invalidId": "ID de galeria inválido",
        "api.gallery.queryImagesFailed": "Falha ao consultar imagens",
        "api.history.queryFailed": "Falha ao consultar histórico de downloads",
        "api.sjsShelf.queryFailed": "Falha ao consultar favoritos SJS",
        "api.sjsShelf.missingUrlAndThreadId": "URL e threadId são obrigatórios",
        "api.sjsShelf.createFailed": "Falha ao criar favorito",
        "api.sjsShelf.deleteFailed": "Falha ao excluir favorito",
        "api.sjsShelf.missingUrlParam": "O parâmetro URL é obrigatório",
        "api.sjsShelf.missingGalleryId": "O parâmetro galleryId é obrigatório",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Verificação de idade aprovada (domínio: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Verificação de idade falhou (domínio: {domain}, status: {status})",
        "log.xsnvshen.ageVerifyError": "Erro na verificação de idade (domínio: {domain}, erro: {error})",
        "log.xsnvshen.httpFetchError": "Falha na solicitação HTTP (domínio: {domain}, erro: {error})",
        "log.xsnvshen.blockedSearchResult": "Resultado de busca bloqueado: \"{title}...\"motivo: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Raspagem de galeria bloqueada: \"{title}...\"motivo: {reason}",
        "log.xsnvshen.gameCharDetected": "Personagens de jogo detectados: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson falhou",
        "log.xsnvshen.listPageFailed": "Falha ao raspar página de lista {page}",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Falha ao limpar mensagem de erro da galeria {galleryId}",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} pausado ({pausedCount} nós)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} não encontrado, não é possível pausar",
    },
}

# ==================== fr-FR（法语）====================
TRANSLATIONS["fr-FR"] = {
    "api": {
        "api.dag.schedulerRequired": "Le contrôle DAG nécessite un planificateur (Phase 3)",
        "api.common.databaseUnavailable": "Base de données indisponible",
        "api.common.missingBody": "Le corps de la requête ne peut pas être vide",
        "api.common.invalidJson": "Corps JSON de requête invalide",
        "api.common.endpointNotFound": "Point d'accès introuvable",
        "api.common.methodNotAllowed": "Méthode non autorisée",
        "api.common.streamingNotSupported": "Streaming non pris en charge",
        "api.common.invalidId": "ID invalide",
        "api.common.keyRequired": "Le paramètre key est obligatoire",
        "api.accounts.queryFailed": "Échec de la consultation des comptes",
        "api.accounts.missingFields": "siteId, username et password sont obligatoires",
        "api.accounts.createFailed": "Échec de la création du compte",
        "api.accounts.updateFailed": "Échec de la mise à jour du compte",
        "api.accounts.deleteFailed": "Échec de la suppression du compte",
        "api.persons.queryFailed": "Échec de la consultation des protagonistes",
        "api.persons.missingName": "Le paramètre name est obligatoire",
        "api.persons.createFailed": "Échec de la création du protagoniste",
        "api.persons.updateFailed": "Échec de la mise à jour du protagoniste",
        "api.persons.deleteFailed": "Échec de la suppression du protagoniste",
        "api.blocklist.queryFailed": "Échec de la consultation des règles de blocage",
        "api.blocklist.missingFields": "fieldType et keyword sont obligatoires",
        "api.blocklist.createFailed": "Échec de la création de la règle de blocage",
        "api.blocklist.updateFailed": "Échec de la mise à jour de la règle de blocage",
        "api.blocklist.deleteFailed": "Échec de la suppression de la règle de blocage",
        "api.config.queryFailed": "Échec de la consultation de la configuration",
        "api.config.updateFailed": "Échec de la mise à jour de la configuration",
        "api.preferences.queryFailed": "Échec de la consultation des préférences utilisateur",
        "api.preferences.updateFailed": "Échec de la mise à jour des préférences utilisateur",
        "api.tasks.queryFailed": "Échec de la consultation des tâches",
        "api.tasks.missingUrl": "L'URL est obligatoire",
        "api.tasks.createFailed": "Échec de la création de la tâche",
        "api.tasks.invalidId": "ID de tâche invalide",
        "api.tasks.notFound": "Tâche introuvable",
        "api.tasks.schedulerRequired": "Les opérations de tâche nécessitent un planificateur (Phase 3)",
        "api.gallery.queryFailed": "Échec de la consultation des galeries",
        "api.gallery.invalidId": "ID de galerie invalide",
        "api.gallery.queryImagesFailed": "Échec de la consultation des images",
        "api.history.queryFailed": "Échec de la consultation de l'historique de téléchargements",
        "api.sjsShelf.queryFailed": "Échec de la consultation des favoris SJS",
        "api.sjsShelf.missingUrlAndThreadId": "URL et threadId sont obligatoires",
        "api.sjsShelf.createFailed": "Échec de la création du favori",
        "api.sjsShelf.deleteFailed": "Échec de la suppression du favori",
        "api.sjsShelf.missingUrlParam": "Le paramètre URL est obligatoire",
        "api.sjsShelf.missingGalleryId": "Le paramètre galleryId est obligatoire",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Vérification d'âge réussie (domaine : {domain})",
        "log.xsnvshen.ageVerifyFailed": "Échec de la vérification d'âge (domaine : {domain}, statut : {status})",
        "log.xsnvshen.ageVerifyError": "Erreur de vérification d'âge (domaine : {domain}, erreur : {error})",
        "log.xsnvshen.httpFetchError": "Échec de la requête HTTP (domaine : {domain}, erreur : {error})",
        "log.xsnvshen.blockedSearchResult": "Résultat de recherche bloqué : \"{title}...\"motif : {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Extraction de galerie bloquée : \"{title}...\"motif : {reason}",
        "log.xsnvshen.gameCharDetected": "Personnages de jeu détectés : {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson a échoué",
        "log.xsnvshen.listPageFailed": "Échec de l'extraction de la page de liste {page}",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Échec de l'effacement du message d'erreur de la galerie {galleryId}",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} mis en pause ({pausedCount} nœuds)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} introuvable, mise en pause impossible",
    },
}

# ==================== id-ID（印度尼西亚语）====================
TRANSLATIONS["id-ID"] = {
    "api": {
        "api.dag.schedulerRequired": "Kontrol DAG memerlukan penjadwal (Phase 3)",
        "api.common.databaseUnavailable": "Database tidak tersedia",
        "api.common.missingBody": "Isi permintaan tidak boleh kosong",
        "api.common.invalidJson": "Isi JSON permintaan tidak valid",
        "api.common.endpointNotFound": "Endpoint tidak ditemukan",
        "api.common.methodNotAllowed": "Metode tidak diizinkan",
        "api.common.streamingNotSupported": "Streaming tidak didukung",
        "api.common.invalidId": "ID tidak valid",
        "api.common.keyRequired": "Parameter key wajib diisi",
        "api.accounts.queryFailed": "Gagal mengambil akun",
        "api.accounts.missingFields": "siteId, username, dan password wajib diisi",
        "api.accounts.createFailed": "Gagal membuat akun",
        "api.accounts.updateFailed": "Gagal memperbarui akun",
        "api.accounts.deleteFailed": "Gagal menghapus akun",
        "api.persons.queryFailed": "Gagal mengambil pemeran",
        "api.persons.missingName": "Parameter name wajib diisi",
        "api.persons.createFailed": "Gagal membuat pemeran",
        "api.persons.updateFailed": "Gagal memperbarui pemeran",
        "api.persons.deleteFailed": "Gagal menghapus pemeran",
        "api.blocklist.queryFailed": "Gagal mengambil aturan blokir",
        "api.blocklist.missingFields": "fieldType dan keyword wajib diisi",
        "api.blocklist.createFailed": "Gagal membuat aturan blokir",
        "api.blocklist.updateFailed": "Gagal memperbarui aturan blokir",
        "api.blocklist.deleteFailed": "Gagal menghapus aturan blokir",
        "api.config.queryFailed": "Gagal mengambil konfigurasi",
        "api.config.updateFailed": "Gagal memperbarui konfigurasi",
        "api.preferences.queryFailed": "Gagal mengambil preferensi pengguna",
        "api.preferences.updateFailed": "Gagal memperbarui preferensi pengguna",
        "api.tasks.queryFailed": "Gagal mengambil tugas",
        "api.tasks.missingUrl": "URL wajib diisi",
        "api.tasks.createFailed": "Gagal membuat tugas",
        "api.tasks.invalidId": "ID tugas tidak valid",
        "api.tasks.notFound": "Tugas tidak ditemukan",
        "api.tasks.schedulerRequired": "Operasi tugas memerlukan penjadwal (Phase 3)",
        "api.gallery.queryFailed": "Gagal mengambil galeri",
        "api.gallery.invalidId": "ID galeri tidak valid",
        "api.gallery.queryImagesFailed": "Gagal mengambil gambar",
        "api.history.queryFailed": "Gagal mengambil riwayat unduhan",
        "api.sjsShelf.queryFailed": "Gagal mengambil bookmark SJS",
        "api.sjsShelf.missingUrlAndThreadId": "URL dan threadId wajib diisi",
        "api.sjsShelf.createFailed": "Gagal membuat bookmark",
        "api.sjsShelf.deleteFailed": "Gagal menghapus bookmark",
        "api.sjsShelf.missingUrlParam": "Parameter URL wajib diisi",
        "api.sjsShelf.missingGalleryId": "Parameter galleryId wajib diisi",
    },
    "log": {
        "log.xsnvshen.ageVerifySuccess": "Verifikasi usia berhasil (domain: {domain})",
        "log.xsnvshen.ageVerifyFailed": "Verifikasi usia gagal (domain: {domain}, status: {status})",
        "log.xsnvshen.ageVerifyError": "Kesalahan verifikasi usia (domain: {domain}, kesalahan: {error})",
        "log.xsnvshen.httpFetchError": "Permintaan HTTP gagal (domain: {domain}, kesalahan: {error})",
        "log.xsnvshen.blockedSearchResult": "Hasil pencarian diblokir: \"{title}...\"alasan: {reason}",
        "log.xsnvshen.blockedGalleryScrape": "Scraping galeri diblokir: \"{title}...\"alasan: {reason}",
        "log.xsnvshen.gameCharDetected": "Karakter game terdeteksi: {chars}",
        "log.xsnvshen.learnPersonFailed": "learnPerson gagal",
        "log.xsnvshen.listPageFailed": "Gagal scraping halaman daftar {page}",
        "log.dagOrchestrator.clearErrorMsgFailed": "[DagOrchestrator] Gagal menghapus pesan kesalahan galeri {galleryId}",
        "log.dagOrchestrator.dagPaused": "[DagOrchestrator] DAG {dagId} dijeda ({pausedCount} node)",
        "log.dagOrchestrator.dagNotFoundCannotPause": "[DagOrchestrator] DAG {dagId} tidak ditemukan, tidak dapat menjeda",
    },
}

# ==================== pt-BR / fr-FR / id-ID 的 ui 模块 ====================
# （这三个语言缺少 nav.* 与 sjs.shelf.* 系列）
def _ui_ptbr():
    return {
        "nav.dashboard": "Salão PuchiPix",
        "nav.tasks": "Gerenciar tarefas",
        "nav.search": "Busca e raspagem",
        "nav.config": "Configurações",
        "nav.configGeneral": "Configurações gerais",
        "nav.blocklist": "Lista de bloqueio",
        "nav.protagonists": "Protagonistas",
        "nav.sniff": "Sniffing",
        "nav.navigation": "Navegação",
        "nav.logoSub": "Central de recursos PuchiPix",
        "nav.lightMode": "Modo claro",
        "nav.darkMode": "Modo escuro",
        "nav.switchToDark": "Alternar para modo escuro",
        "nav.switchToLight": "Alternar para modo claro",
        "sjs.comingSoon": "SJS em breve",
        "sjs.underConstruction": "Em construção, aguarde",
        "sjs.shelf.batchImport": "Importação em lote",
        "sjs.shelf.searchPlaceholder": "Buscar título, autor, URL...",
        "sjs.shelf.allForums": "Todos os fóruns",
        "sjs.shelf.clearAll": "Limpar",
        "sjs.shelf.noBookmarks": "Sem favoritos",
        "sjs.shelf.noMatchingBookmarks": "Nenhum favorito correspondente",
        "sjs.shelf.emptyHint": "Clique no botão de importação em lote e cole URLs de posts do SJS para começar",
        "sjs.shelf.emptyHintFilter": "Tente modificar os critérios de busca ou limpar os filtros",
        "sjs.shelf.untitled": "Sem título",
        "sjs.shelf.openOriginal": "Ver post original",
        "sjs.shelf.refreshMetadata": "Atualizar informações",
        "sjs.shelf.importTitle": "Importar URLs do SJS em lote",
        "sjs.shelf.importDesc": "Uma URL por linha, suporta todos os domínios espelhados do SJS",
        "sjs.shelf.importPlaceholder": "Cole URLs de posts do SJS, uma por linha...\nExemplo:\nhttps://xsijishe.ink/thread-712479-1-1.html\nhttps://sjs96.com/thread-709880-1-1.html",
        "sjs.shelf.urlCount": "{count} URLs no total",
        "sjs.shelf.importing": "Importando...",
        "sjs.shelf.confirmImport": "Iniciar importação",
        "sjs.shelf.importMore": "Continuar importando",
        "sjs.shelf.totalCards": "Total",
        "sjs.shelf.createdCount": "Novos",
        "sjs.shelf.skippedCount": "Ignorados",
        "sjs.shelf.failedCount": "Falhas",
        "sjs.shelf.fetchFailed": "Falha ao obter lista de favoritos",
        "sjs.shelf.noUrlsToImport": "Insira pelo menos uma URL",
        "sjs.shelf.importFailed": "Falha na importação: {error}",
        "sjs.shelf.importSuccess": "Importação concluída: {created} novos, {skipped} ignorados, {failed} falhas",
        "sjs.shelf.importNetworkError": "Falha na solicitação de importação, verifique a rede",
        "sjs.shelf.deleteConfirm": "Excluir este favorito?",
        "sjs.shelf.deleted": "Excluído",
        "sjs.shelf.deleteFailed": "Falha ao excluir",
        "sjs.shelf.clearAllConfirm": "Limpar todos os favoritos? Esta ação não pode ser desfeita!",
        "sjs.shelf.clearedAll": "Todos os favoritos foram limpos",
        "sjs.shelf.clearFailed": "Falha ao limpar",
        "sjs.shelf.refreshFailed": "Falha ao atualizar: {error}",
        "sjs.shelf.refreshed": "Atualizado",
        "sjs.shelf.refreshNetworkError": "Falha na solicitação de atualização, verifique a rede",
    }

def _ui_frfr():
    return {
        "nav.dashboard": "Hall PuchiPix",
        "nav.tasks": "Gestion des tâches",
        "nav.search": "Recherche & scraping",
        "nav.config": "Configuration",
        "nav.configGeneral": "Configuration générale",
        "nav.blocklist": "Liste noire",
        "nav.protagonists": "Protagonistes",
        "nav.sniff": "Sniffing",
        "nav.navigation": "Navigation",
        "nav.logoSub": "Atelier de ressources PuchiPix",
        "nav.lightMode": "Mode clair",
        "nav.darkMode": "Mode sombre",
        "nav.switchToDark": "Passer en mode sombre",
        "nav.switchToLight": "Passer en mode clair",
        "sjs.comingSoon": "SJS bientôt disponible",
        "sjs.underConstruction": "En construction, à venir",
        "sjs.shelf.batchImport": "Importation groupée",
        "sjs.shelf.searchPlaceholder": "Rechercher titre, auteur, URL...",
        "sjs.shelf.allForums": "Tous les forums",
        "sjs.shelf.clearAll": "Tout effacer",
        "sjs.shelf.noBookmarks": "Aucun favori",
        "sjs.shelf.noMatchingBookmarks": "Aucun favori correspondant",
        "sjs.shelf.emptyHint": "Cliquez sur le bouton d'importation groupée et collez les URLs de posts SJS pour commencer",
        "sjs.shelf.emptyHintFilter": "Essayez de modifier les critères de recherche ou d'effacer les filtres",
        "sjs.shelf.untitled": "Sans titre",
        "sjs.shelf.openOriginal": "Voir le post original",
        "sjs.shelf.refreshMetadata": "Actualiser les informations",
        "sjs.shelf.importTitle": "Importer des URLs SJS en lot",
        "sjs.shelf.importDesc": "Une URL par ligne, prend en charge tous les domaines miroirs SJS",
        "sjs.shelf.importPlaceholder": "Collez les URLs de posts SJS, une par ligne...\nExemple :\nhttps://xsijishe.ink/thread-712479-1-1.html\nhttps://sjs96.com/thread-709880-1-1.html",
        "sjs.shelf.urlCount": "{count} URLs au total",
        "sjs.shelf.importing": "Importation en cours...",
        "sjs.shelf.confirmImport": "Démarrer l'importation",
        "sjs.shelf.importMore": "Continuer l'importation",
        "sjs.shelf.totalCards": "Total",
        "sjs.shelf.createdCount": "Nouveaux",
        "sjs.shelf.skippedCount": "Ignorés",
        "sjs.shelf.failedCount": "Échecs",
        "sjs.shelf.fetchFailed": "Échec de la récupération de la liste des favoris",
        "sjs.shelf.noUrlsToImport": "Veuillez saisir au moins une URL",
        "sjs.shelf.importFailed": "Échec de l'importation : {error}",
        "sjs.shelf.importSuccess": "Importation terminée : {created} nouveaux, {skipped} ignorés, {failed} échecs",
        "sjs.shelf.importNetworkError": "Échec de la demande d'importation, vérifiez le réseau",
        "sjs.shelf.deleteConfirm": "Supprimer ce favori ?",
        "sjs.shelf.deleted": "Supprimé",
        "sjs.shelf.deleteFailed": "Échec de la suppression",
        "sjs.shelf.clearAllConfirm": "Effacer tous les favoris ? Cette action est irréversible !",
        "sjs.shelf.clearedAll": "Tous les favoris ont été effacés",
        "sjs.shelf.clearFailed": "Échec de l'effacement",
        "sjs.shelf.refreshFailed": "Échec de l'actualisation : {error}",
        "sjs.shelf.refreshed": "Actualisé",
        "sjs.shelf.refreshNetworkError": "Échec de la demande d'actualisation, vérifiez le réseau",
    }

def _ui_idid():
    return {
        "nav.dashboard": "Aula PuchiPix",
        "nav.tasks": "Kelola tugas",
        "nav.search": "Cari & scrape",
        "nav.config": "Konfigurasi",
        "nav.configGeneral": "Konfigurasi umum",
        "nav.blocklist": "Daftar blokir",
        "nav.protagonists": "Pemeran",
        "nav.sniff": "Sniff",
        "nav.navigation": "Navigasi",
        "nav.logoSub": "Pusat sumber daya PuchiPix",
        "nav.lightMode": "Mode terang",
        "nav.darkMode": "Mode gelap",
        "nav.switchToDark": "Beralih ke mode gelap",
        "nav.switchToLight": "Beralih ke mode terang",
        "sjs.comingSoon": "SJS segera hadir",
        "sjs.underConstruction": "Sedang dibangun, nantikan",
        "sjs.shelf.batchImport": "Impor massal",
        "sjs.shelf.searchPlaceholder": "Cari judul, penulis, URL...",
        "sjs.shelf.allForums": "Semua forum",
        "sjs.shelf.clearAll": "Bersihkan",
        "sjs.shelf.noBookmarks": "Tidak ada bookmark",
        "sjs.shelf.noMatchingBookmarks": "Tidak ada bookmark yang cocok",
        "sjs.shelf.emptyHint": "Klik tombol impor massal dan tempel URL posting SJS untuk memulai",
        "sjs.shelf.emptyHintFilter": "Coba ubah kriteria pencarian atau hapus filter",
        "sjs.shelf.untitled": "Tanpa judul",
        "sjs.shelf.openOriginal": "Lihat posting asli",
        "sjs.shelf.refreshMetadata": "Segarkan info",
        "sjs.shelf.importTitle": "Impor URL SJS secara massal",
        "sjs.shelf.importDesc": "Satu URL per baris, mendukung semua domain mirror SJS",
        "sjs.shelf.importPlaceholder": "Tempel URL posting SJS, satu per baris...\nContoh:\nhttps://xsijishe.ink/thread-712479-1-1.html\nhttps://sjs96.com/thread-709880-1-1.html",
        "sjs.shelf.urlCount": "Total {count} URL",
        "sjs.shelf.importing": "Mengimpor...",
        "sjs.shelf.confirmImport": "Mulai impor",
        "sjs.shelf.importMore": "Lanjutkan impor",
        "sjs.shelf.totalCards": "Total",
        "sjs.shelf.createdCount": "Baru",
        "sjs.shelf.skippedCount": "Dilewati",
        "sjs.shelf.failedCount": "Gagal",
        "sjs.shelf.fetchFailed": "Gagal mengambil daftar bookmark",
        "sjs.shelf.noUrlsToImport": "Masukkan setidaknya satu URL",
        "sjs.shelf.importFailed": "Impor gagal: {error}",
        "sjs.shelf.importSuccess": "Impor selesai: {created} baru, {skipped} dilewati, {failed} gagal",
        "sjs.shelf.importNetworkError": "Permintaan impor gagal, periksa jaringan",
        "sjs.shelf.deleteConfirm": "Hapus bookmark ini?",
        "sjs.shelf.deleted": "Dihapus",
        "sjs.shelf.deleteFailed": "Gagal menghapus",
        "sjs.shelf.clearAllConfirm": "Bersihkan semua bookmark? Tindakan ini tidak dapat dibatalkan!",
        "sjs.shelf.clearedAll": "Semua bookmark telah dibersihkan",
        "sjs.shelf.clearFailed": "Gagal membersihkan",
        "sjs.shelf.refreshFailed": "Gagal menyegarkan: {error}",
        "sjs.shelf.refreshed": "Disegarkan",
        "sjs.shelf.refreshNetworkError": "Permintaan penyegaran gagal, periksa jaringan",
    }

TRANSLATIONS["pt-BR"]["ui"] = _ui_ptbr()
TRANSLATIONS["fr-FR"]["ui"] = _ui_frfr()
TRANSLATIONS["id-ID"]["ui"] = _ui_idid()

# 补 ui 模块（pt-BR/fr-FR/id-ID）还需 sjs.shelf 外的部分已在上面函数中覆盖全部 52 个 key

# ==================== 新增 UI key（common.backHome 等，所有语言）====================
NEW_UI_KEYS = {
    "common.backHome": {
        "zh-CN": "返回首页", "zh-TW": "返回首頁", "en-US": "Back to home", "ja-JP": "ホームに戻る",
        "ko-KR": "홈으로 돌아가기", "ru-RU": "На главную", "de-DE": "Zur Startseite", "vi-VN": "Về trang chủ",
        "es-ES": "Volver al inicio", "pt-BR": "Voltar ao início", "fr-FR": "Retour à l'accueil", "id-ID": "Kembali ke beranda",
    },
    "common.unknownError": {
        "zh-CN": "未知错误", "zh-TW": "未知錯誤", "en-US": "Unknown error", "ja-JP": "不明なエラー",
        "ko-KR": "알 수 없는 오류", "ru-RU": "Неизвестная ошибка", "de-DE": "Unbekannter Fehler", "vi-VN": "Lỗi không xác định",
        "es-ES": "Error desconocido", "pt-BR": "Erro desconhecido", "fr-FR": "Erreur inconnue", "id-ID": "Kesalahan tidak diketahui",
    },
    "error.pageError": {
        "zh-CN": "页面出现异常", "zh-TW": "頁面發生異常", "en-US": "Something went wrong", "ja-JP": "ページでエラーが発生しました",
        "ko-KR": "페이지에 오류가 발생했습니다", "ru-RU": "Произошла ошибка на странице", "de-DE": "Auf der Seite ist ein Fehler aufgetreten", "vi-VN": "Đã xảy ra lỗi trên trang",
        "es-ES": "Se produjo un error en la página", "pt-BR": "Ocorreu um erro na página", "fr-FR": "Une erreur s'est produite sur la page", "id-ID": "Terjadi kesalahan pada halaman",
    },
    "error.pageErrorDesc": {
        "zh-CN": "应用捕获到未预期的错误。你可以尝试重试当前操作，或返回首页继续使用。",
        "zh-TW": "應用程式捕獲到未預期的錯誤。您可以嘗試重試目前操作，或返回首頁繼續使用。",
        "en-US": "The app caught an unexpected error. You can retry the current action or go back to the home page.",
        "ja-JP": "アプリで予期しないエラーが発生しました。現在の操作を再試行するか、ホームページに戻って続行できます。",
        "ko-KR": "앱에서 예기치 않은 오류가 발생했습니다. 현재 작업을 다시 시도하거나 홈페이지로 돌아가 계속할 수 있습니다.",
        "ru-RU": "Приложение обнаружило непредвиденную ошибку. Вы можете повторить операцию или вернуться на главную страницу.",
        "de-DE": "Die App hat einen unerwarteten Fehler abgefangen. Sie können den Vorgang erneut versuchen oder zur Startseite zurückkehren.",
        "vi-VN": "Ứng dụng đã gặp lỗi không mong muốn. Bạn có thể thử lại thao tác hiện tại hoặc quay về trang chủ.",
        "es-ES": "La aplicación detectó un error inesperado. Puede reintentar la operación actual o volver a la página de inicio.",
        "pt-BR": "O aplicativo encontrou um erro inesperado. Você pode tentar novamente a operação atual ou voltar para a página inicial.",
        "fr-FR": "L'application a rencontré une erreur inattendue. Vous pouvez réessayer l'opération actuelle ou revenir à l'accueil.",
        "id-ID": "Aplikasi mengalami kesalahan tak terduga. Anda dapat mencoba lagi operasi saat ini atau kembali ke beranda.",
    },
    "error.digest": {
        "zh-CN": "错误标识：", "zh-TW": "錯誤識別碼：", "en-US": "Error ID: ", "ja-JP": "エラーID: ",
        "ko-KR": "오류 ID: ", "ru-RU": "Идентификатор ошибки: ", "de-DE": "Fehler-ID: ", "vi-VN": "Mã lỗi: ",
        "es-ES": "ID de error: ", "pt-BR": "ID do erro: ", "fr-FR": "ID d'erreur : ", "id-ID": "ID kesalahan: ",
    },
    "error.notFoundTitle": {
        "zh-CN": "未找到对应的页面", "zh-TW": "找不到對應的頁面", "en-US": "Page not found", "ja-JP": "ページが見つかりません",
        "ko-KR": "페이지를 찾을 수 없습니다", "ru-RU": "Страница не найдена", "de-DE": "Seite nicht gefunden", "vi-VN": "Không tìm thấy trang",
        "es-ES": "Página no encontrada", "pt-BR": "Página não encontrada", "fr-FR": "Page introuvable", "id-ID": "Halaman tidak ditemukan",
    },
    "error.notFoundDesc": {
        "zh-CN": "它可能已被移动、删除，或从未存在。", "zh-TW": "它可能已被移動、刪除，或從未存在。", "en-US": "It may have been moved, deleted, or never existed.",
        "ja-JP": "移動または削除されたか、存在しない可能性があります。", "ko-KR": "이동되거나 삭제되었거나 존재하지 않았을 수 있습니다.",
        "ru-RU": "Возможно, она была перемещена, удалена или никогда не существовала.", "de-DE": "Sie wurde möglicherweise verschoben, gelöscht oder hat nie existiert.",
        "vi-VN": "Trang có thể đã bị di chuyển, xóa hoặc chưa từng tồn tại.", "es-ES": "Puede haber sido movida, eliminada o nunca haber existido.",
        "pt-BR": "Ela pode ter sido movida, excluída ou nunca ter existido.", "fr-FR": "Elle a peut-être été déplacée, supprimée ou n'a jamais existé.",
        "id-ID": "Halaman mungkin telah dipindahkan, dihapus, atau tidak pernah ada.",
    },
    "modelstage.title": {
        "zh-CN": "模特台", "zh-TW": "模特台", "en-US": "Model Stage", "ja-JP": "モデルステージ",
        "ko-KR": "모델 스테이지", "ru-RU": "Сцена моделей", "de-DE": "Modelbühne", "vi-VN": "Sân khấu người mẫu",
        "es-ES": "Escenario de modelos", "pt-BR": "Palco de modelos", "fr-FR": "Scène des modèles", "id-ID": "Panggung Model",
    },
    "modelstage.comingSoon": {
        "zh-CN": "即将上线，敬请期待", "zh-TW": "即將上線，敬請期待", "en-US": "Coming soon, stay tuned", "ja-JP": "近日公開予定です",
        "ko-KR": "곧 출시됩니다", "ru-RU": "Скоро появится, следите за обновлениями", "de-DE": "Bald verfügbar, bleiben Sie dran",
        "vi-VN": "Sắp ra mắt, hãy chờ đón", "es-ES": "Próximamente, estén atentos", "pt-BR": "Em breve, aguarde", "fr-FR": "Bientôt disponible, restez à l'écoute", "id-ID": "Segera hadir, nantikan",
    },
}

NEW_BLOCKLIST_KEYS = {
    "blocklist.pleaseInputKeyword": {
        "zh-CN": "请输入屏蔽关键词", "zh-TW": "請輸入屏蔽關鍵詞", "en-US": "Please enter a block keyword", "ja-JP": "ブロックキーワードを入力してください",
        "ko-KR": "차단 키워드를 입력하세요", "ru-RU": "Введите ключевое слово для блокировки", "de-DE": "Bitte geben Sie ein Sperr-Keyword ein",
        "vi-VN": "Vui lòng nhập từ khóa chặn", "es-ES": "Introduzca una palabra clave de bloqueo", "pt-BR": "Digite uma palavra-chave de bloqueio", "fr-FR": "Veuillez saisir un mot-clé de blocage", "id-ID": "Masukkan kata kunci blokir",
    },
}

for lang in NEW_UI_KEYS["common.backHome"]:
    ui_extra = {k: v[lang] for k, v in NEW_UI_KEYS.items()}
    if lang not in TRANSLATIONS:
        TRANSLATIONS[lang] = {}
    TRANSLATIONS[lang].setdefault("ui", {})
    TRANSLATIONS[lang]["ui"] = dict(ui_extra, **TRANSLATIONS[lang].get("ui", {}))

for lang in NEW_BLOCKLIST_KEYS["blocklist.pleaseInputKeyword"]:
    bl_extra = {k: v[lang] for k, v in NEW_BLOCKLIST_KEYS.items()}
    TRANSLATIONS[lang].setdefault("blocklist", {})
    TRANSLATIONS[lang]["blocklist"] = dict(bl_extra, **TRANSLATIONS[lang].get("blocklist", {}))

# ==================== 其余语言在后续分块定义 ====================

def insert_missing(filepath, translations):
    """把 translations {key: value} 中缺失的 key 插入文件 `};` 之前。"""
    content = io.open(filepath, encoding="utf-8").read()
    _, existing = parse_ts_keys(filepath)
    missing = {k: v for k, v in translations.items() if k not in existing}
    if not missing:
        return 0
    lines = []
    for k in sorted(missing):
        lines.append(f'  "{k}": "{esc(missing[k])}",')
    block = "\n".join(lines) + "\n"
    # 在最后一个对象闭合标记之前插入（支持 `};` 与 `} satisfies X;`）
    m = list(re.finditer(r"\};|}\s+satisfies\s+\w+;", content))
    if not m:
        raise RuntimeError(f"cannot find closing in {filepath}")
    idx = m[-1].start()
    new_content = content[:idx] + block + content[idx:]
    io.open(filepath, "w", encoding="utf-8", newline="").write(new_content)
    return len(missing)

def main():
    total = 0
    for lang, modules in TRANSLATIONS.items():
        for mod, trans in modules.items():
            fp = os.path.join(LOCALES_DIR, mod, f"{lang}.ts")
            if not os.path.exists(fp):
                print(f"[SKIP] {lang}/{mod} 文件不存在")
                continue
            n = insert_missing(fp, trans)
            total += n
            print(f"[OK] {lang}/{mod}: 插入 {n} 个缺失 key")
    print(f"\n总计插入 {total} 个缺失 key")

if __name__ == "__main__":
    main()
