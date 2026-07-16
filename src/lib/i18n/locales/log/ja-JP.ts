import type { TranslationDict } from "../../types";

// ログメッセージテンプレート — 日本語
const jaJP: TranslationDict = {
  "log.safeDelete.fileFailed": "ファイル削除失敗 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "ファイル削除の最終失敗: {path} — {msg}",
  "log.safeDelete.dirFailed": "ディレクトリ削除失敗 ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "ディレクトリ削除の最終失敗: {path} — {msg}",

  "log.galleryHandler.cancelledInQueue": "ギャラリー #{id} がキュー待機中にキャンセルされました",
  "log.galleryHandler.cancelledInScrapeQueue": "ギャラリー #{id} が識別キュー待機中にキャンセルされました",
  "log.galleryHandler.domainRateLimited": "ドメイン {url} が {status} を返しました（レート制限）、高速切り替え",
  "log.galleryHandler.asyncScrapeError": "ギャラリー #{id} 非同期スクレイプエラー",
  "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",

  "log.sjs.noAccount": "利用可能なアカウントがありません、ゲストモードでアクセスします（全コンテンツが表示されない場合があります）",
  "log.sjs.cookieInjected": "アカウント #{id} Cookie を注入しました（{count} 個）",
  "log.sjs.cookieInjectionFailed": "Cookie 注入失敗、再ログインを試みます",
  "log.sjs.noCookieStartLogin": "有効な Cookie がありません、ログインフローを開始...",
  "log.sjs.loginSuccess": "アカウント #{id} ログイン成功、Cookie を保存しました（{count} 個）",
  "log.sjs.loginFailed": "ログイン失敗",
  "log.sjs.paidContent": "投稿は有料コンテンツです、購入後にダウンロードリンクを表示できます",
  "log.sjs.detectedDownloadLinks": "{count} 個のダウンロードリンクを検出しました（投稿購入済み）",
  "log.sjs.pageNewImages": "投稿 {page} ページ: 新規画像（累計 {total}）",
  "log.sjs.scrapePageFailed": "投稿 {page} ページのスクレイプに失敗しました",
  "log.sjs.learnPersonFailed": "learnPerson 失敗",
  "log.sjs.listPageNoResults": "リストページ {page}: 結果なし、終了",
  "log.sjs.listPageNewResults": "リストページ {page}: {count} 件の新規結果（累計 {total}）",
  "log.sjs.listPageNoNext": "リストページに次ページリンクなし、終了",
  "log.sjs.navNextFailed": "次ページへのナビゲーション失敗",
  "log.sjs.gotFormhash": "formhash 取得: {value}",
  "log.sjs.httpLoginSuccess": "HTTP ログイン成功（{count} 個の Cookie）",
  "log.sjs.signLink": "サインインリンク: {href}",
  "log.sjs.postNotPurchased": "投稿「{title}」は未購入、購入フローを開始...",
  "log.sjs.buyFormParams": "購入フォームパラメータ: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "サインイン開始: {username}",

  "log.siteRegistry.providerNotFound": "サイト「{id}」の Provider 実装が見つかりません",

  "log.siteAccountManager.cookieSaved": "アカウント #{id} Cookie を保存しました（{count} 個）",

  "log.exhentai.scrapePageFailed": "ギャラリー {page} ページのスクレイプに失敗しました",
  "log.exhentai.pageNewLinks": "ギャラリー {page} ページ: {count} 個の画像ページリンクを収集（累計 {total}）",
  "log.exhentai.batchFailed": "画像 URL のバッチ取得に失敗しました (batch {batch})",
  "log.exhentai.listPageNoResults": "リストページ {page}: 結果なし、終了",
  "log.exhentai.listPageNewResults": "リストページ {page}: {count} 件の新規結果（累計 {total}）",
  "log.exhentai.listPageNoNext": "リストページに次ページリンクなし、終了",
  "log.exhentai.navNextFailed": "次ページへのナビゲーション失敗",

  "log.aimeizizi.learnPersonFailed": "learnPerson 失敗",
  "log.aimeizizi.blockedSearchResult": "検索結果をブロック: \"{title}...\", 理由: {reason}",
  "log.aimeizizi.domainRateLimited": "{page} ページで {status} に遭遇、ドメイン {domain} をレート制限にマーク",
  "log.aimeizizi.domainSwitchSuccess": "{page} ページでドメイン {domain} へ切り替え成功",
  "log.aimeizizi.domainSwitchFailed": "{page} ページでドメイン {domain} 失敗: {msg}",
  "log.aimeizizi.scrapePageFailed": "{page} ページのスクレイプに失敗 (ドメイン {domain})",
  "log.aimeizizi.blockedGalleryScrape": "ギャラリースクレイプをブロック: \"{title}...\", 理由: {reason}",
  "log.aimeizizi.gameCharDetected": "ゲームキャラクターを識別: {chars}",
  "log.aimeizizi.listPageFailed": "リストページ {page} のスクレイプに失敗しました",

  "log.scrape.capturedM3u8": "{url} — {count} 個の M3U8 URL をキャプチャ: {urls}",

  "log.protagonist.personCacheInitFailed": "Person キャッシュの初期化に失敗しました",

  "log.search.batchComplete": "一括スクレイプ完了！成功 {ok}、失敗 {fail}",

  // タスクキューマネージャー
  "log.taskQueue.slotAllocated": "スロット割り当て: {key} (実行中: 通常={normal}/{maxNormal}, スニッフ={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "スロット解放: {key} (実行中: 通常={normal}/{maxNormal}, スニッフ={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "識別スロット割り当て: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "識別スロット解放: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "キュー内タスクキャンセル: {type}-{id}",
  "log.taskQueue.scrapingCancel": "キュー内識別タスクキャンセル: {type}-{id}",
  "log.taskQueue.pendingGranted": "キューがスロットを取得: {key} (実行中: 通常={normal}/{maxNormal}, スニッフ={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "キュー識別がスロットを取得: {key} (識別中: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "スロット満杯、タスクキュー待機: {key} (キュー位置 {position})",
  "log.taskQueue.scrapingFull": "識別スロット満杯、タスクキュー待機: {key} (キュー位置 {position})",
  "log.taskQueue.configLoaded": "設定読み込み完了: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.configUpdated": "設定更新完了: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
  "log.taskQueue.listenersRegistered": "EventBus 末端リスナー登録済み",
  "log.taskQueue.resetWarn": "カウンター強制リセット",
  "log.taskQueue.configLoadFailed": "設定の読み込みに失敗、デフォルトを使用: {error}",

  // サーバーライフサイクル
  "log.server.taskStateReset": "起動時タスク状態リセット完了",
  "log.server.downloadManagerInit": "ダウンローダー初期化済み",
  "log.server.eventBusBridgeInit": "EventBus ブリッジ初期化済み",
  "log.server.ouoOrchestratorStart": "OUO オーケストレーター起動済み",

  // タスク状態リセット
  "log.taskStateReset.started": "実行中タスク状態リセットを開始...",
  "log.taskStateReset.cleanupSlots": "残留スロットクリーンアップ: 通常={normal}, スニッフ={sniff}, 識別={scraping}",
  "log.taskStateReset.completed": "リセット完了: 動画 {videoTasks}, ギャラリー {galleries}, 画像 {galleryImages}, 動画 {galleryVideos}, スニッフ {sniffTasks}, ZIP情報 {galleryDownloadInfos}, 計 {total} タスクを保留中にリセット",
  "log.taskStateReset.noop": "実行中タスクなし、リセット不要",
};

export default jaJP;
