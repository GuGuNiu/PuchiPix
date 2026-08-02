package db

// TableNames centralizes database table names matching the schema
// @@map annotations, avoiding string literals scattered across queries.
const (
	TableDownloadTask        = "download_tasks"
	TableVideoInfo           = "video_infos"
	TableGallery             = "galleries"
	TableGalleryImage        = "gallery_images"
	TableGalleryVideo        = "gallery_videos"
	TableGalleryDownloadInfo = "gallery_download_infos"
	TableSniffTask           = "sniff_tasks"
	TableAppConfig           = "app_configs"
	TableSiteAccount         = "site_accounts"
	TablePerson             = "persons"
	TableBlocklistRule       = "blocklist_rules"
	TableUserPreference      = "user_preferences"
	TableDagEvent            = "dag_events"
	TableDagSnapshot         = "dag_snapshots"
	TableDownloadHistory     = "download_history"
	TableSjsBookmark         = "sjs_bookmarks"
	TableSiteConfig          = "site_configs"
)
