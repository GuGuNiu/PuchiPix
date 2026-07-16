import type { TranslationDict } from "../../types";

// API エラーメッセージ — 日本語
const jaJP: TranslationDict = {
  "api.validation.maxConcurrentTasks": "同時実行タスク数は 1~50 の範囲で指定してください",
  "api.validation.maxSniffConcurrent": "スニッフ最大並行数は 1~10 の範囲で指定してください",
  "api.validation.maxScrapingSlots": "識別中最大数は 1~50 の範囲で指定してください",
  "api.validation.tsSegmentConcurrent": "TS セグメント並行数は 1~200 の範囲で指定してください",
  "api.validation.galleryImageConcurrent": "ギャラリー画像並行数は 1~50 の範囲で指定してください",

  "api.sjs.missingAction": "action パラメータが不足しています",
  "api.sjs.signMissingAccountId": "サインインには accountId パラメータが必要です",
  "api.sjs.buyMissingAccountId": "投稿購入には accountId パラメータが必要です",
  "api.sjs.buyMissingTid": "投稿購入には tid パラメータ（投稿 ID）が必要です",
  "api.sjs.loginMissingAccountId": "ログインには accountId パラメータが必要です",

  "api.search.missingJobId": "jobId を指定してください",
  "api.search.batchScrapeStarted": "一括スクレイプを開始しました",
  "api.search.missingPageUrl": "pageUrl を指定してください",
  "api.search.videoNotFound": "該当する動画項目が見つかりません",
  "api.search.missingKeyword": "検索キーワードを指定してください",
  "api.search.missingVideoTitle": "動画タイトルを指定してください",

  "api.protagonist.galleryNotFound": "このキャラのギャラリーが見つかりません",
  "api.protagonist.fetchFailed": "キャラ情報の取得に失敗しました",

  "api.ouo.missingParams": "必須パラメータが不足しています: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "必須パラメータが不足しています: galleryId",

  "api.gallery.notFound": "ギャラリーが存在しません",
  "api.gallery.noProviderMatch": "一致するサイトプロバイダーが見つかりません、再スクレイプできません",
  "api.gallery.rescrapeStarted": "ギャラリーの再スクレイプを開始しました",
  "api.gallery.retryFailedStarted": "失敗ファイルの再試行を開始しました",
  "api.gallery.downloadStarted": "ギャラリーダウンロードを開始しました",
  "api.gallery.noZipInfo": "このギャラリーには ZIP ダウンロード情報がありません",
  "api.gallery.noDownloadUrl": "ダウンロード URL がありません、ミラーサイトリンクを手動で入力してください",
  "api.gallery.invalidSource": "ouo.io ソースのみオーケストレーターエンキューに対応、現在のソースは {source}",
  "api.gallery.noZipData": "ZIP ダウンロード情報がありません",
  "api.gallery.noProvider": "一致するサイトプロバイダーが見つかりません",
  "api.gallery.alreadyScraping": "このギャラリーは別のタスクでスクレイプ中です、後で再試行してください",
  "api.gallery.pageNotFound": "ページが存在しません (404)",
  "api.gallery.pageNotFoundSkipped": "ページが存在しません (404)、スキップしました",

  "api.tasks.noM3u8Extracted": "ページから M3U8 リンクを抽出できません",

  "api.blocklist.addFailed": "追加失敗",

  "api.common.internalError": "サーバー内部エラー",
  "api.common.missingParams": "必須パラメータが不足しています: {params}",
};

export default jaJP;
