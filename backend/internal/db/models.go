package db

import "time"

// DownloadTask represents a video download task (m3u8/mp4).
//
// JSON tags use PascalCase to match the frontend TypeScript interface.
// The Go field Seq maps to the JSON key "DisplayID" because the frontend
// uses DisplayID as the user-facing identifier.
type DownloadTask struct {
	ID        int       `json:"ID" db:"id"`
	URL       string    `json:"URL" db:"url"`
	M3U8URL   string    `json:"M3U8URL" db:"m3u8_url"`
	Status    string    `json:"Status" db:"status"`
	Progress  float64   `json:"Progress" db:"progress"`
	FilePath  string    `json:"FilePath" db:"file_path"`
	Format    string    `json:"Format" db:"format"`
	Priority  int       `json:"Priority" db:"priority"`
	ErrorMsg  string    `json:"ErrorMsg" db:"error_msg"`
	SiteID    string    `json:"SiteID" db:"site_id"`
	Seq       *string   `json:"DisplayID" db:"seq"`
	CreatedAt time.Time `json:"CreatedAt" db:"created_at"`
	UpdatedAt time.Time `json:"UpdatedAt" db:"updated_at"`
	Title  string `json:"GalleryTitle"`
	Person string `json:"Person"`
	Tags   []string `json:"Tags"`
	// VideoInfo carries the joined video_infos metadata for detail views
	// (title/duration/resolution/size/tags). Nil when the task has no
	// video_infos row yet (e.g. before the first scrape completes).
	VideoInfo *VideoInfo `json:"VideoInfo,omitempty"`
	TotalSegments int `json:"TotalSegments" db:"total_segments"`
	Segment       int `json:"Segment" db:"completed_segments"`
	FileSize int64 `json:"FileSize" db:"file_size"`
	// Computed fields (not stored in DB, populated by helper functions at query time).
	EffectiveStatus string   `json:"EffectiveStatus" db:"-"`
	ProgressStage   string   `json:"ProgressStage" db:"-"`
	AllowedActions  []string `json:"AllowedActions" db:"-"`
}

// VideoInfo stores metadata extracted from a download task's source URL.
//
// Tags/Actors/Categories are typed []string so the JSON contract matches
// the frontend (`string[]`). The DB columns are JSON-array strings; the
// API layer must decode them via task_compute.ParseTagsColumn before
// populating this struct — never assign the raw column text (a JSON
// string in a string field serialized the whole `["a","b"]` literal,
// which the frontend then rendered as garbage tag pills / crashes).
type VideoInfo struct {
	ID         int       `json:"ID" db:"id"`
	TaskID     int       `json:"TaskID" db:"task_id"`
	Title      string    `json:"Title" db:"title"`
	SourceURL  string    `json:"SourceURL" db:"source_url"`
	FileSize   int64     `json:"FileSize" db:"file_size"`
	Duration   float64   `json:"Duration" db:"duration"`
	Tags       []string  `json:"Tags" db:"tags"`
	Actors     []string  `json:"Actors" db:"actors"`
	Categories []string  `json:"Categories" db:"categories"`
	Director   string    `json:"Director" db:"director"`
	Resolution string    `json:"Resolution" db:"resolution"`
	CreatedAt  time.Time `json:"CreatedAt" db:"created_at"`
}

// Gallery is the central model for a multi-site image/video collection,
// linking images, videos, and download metadata through a 1-to-many
// and 1-to-1 relationship respectively.
type Gallery struct {
	ID                  int        `json:"ID" db:"id"`
	Seq                 *string    `json:"DisplayID" db:"seq"`
	SourceURL           string     `json:"SourceURL" db:"source_url"`
	SiteID              string     `json:"SiteID" db:"site_id"`
	ScrapedDomain       string     `json:"ScrapedDomain" db:"scraped_domain"`
	Title               string     `json:"Title" db:"title"`
	Protagonist         string     `json:"Protagonist" db:"protagonist"`
	Description         string     `json:"Description" db:"description"`
	Category            string     `json:"Category" db:"category"`
	Tags                string     `json:"Tags" db:"tags"`
	CoverURL            string     `json:"CoverURL" db:"cover_url"`
	CoverLocalPath      string     `json:"CoverLocalPath" db:"cover_local_path"`
	ImageCount          int        `json:"ImageCount" db:"image_count"`
	VideoCount          int        `json:"VideoCount" db:"video_count"`
	PageCount           int        `json:"PageCount" db:"page_count"`
	Status              string     `json:"Status" db:"status"`
	ErrorMsg            string     `json:"ErrorMsg" db:"error_msg"`
	DownloadMethod      string     `json:"DownloadMethod" db:"download_method"`
	ExpectedImageCount  int        `json:"ExpectedImageCount" db:"expected_image_count"`
	ExpectedVideoCount  int        `json:"ExpectedVideoCount" db:"expected_video_count"`
	ContentVerified     bool       `json:"ContentVerified" db:"content_verified"`
	SavePath            string     `json:"SavePath" db:"save_path"`
	TotalSize           int64      `json:"TotalSize" db:"total_size"`
	DownloadedSize      int64      `json:"DownloadedSize" db:"downloaded_size"`
	GameCharacters      *string    `json:"GameCharacters" db:"game_characters"`
	PublishTime         *string    `json:"PublishTime" db:"publish_time"`
	ScrapedAt           *time.Time `json:"ScrapedAt" db:"scraped_at"`
	CompletedAt         *time.Time `json:"CompletedAt" db:"completed_at"`
	CreatedAt           time.Time  `json:"CreatedAt" db:"created_at"`
	UpdatedAt           time.Time  `json:"UpdatedAt" db:"updated_at"`
	// Videos is populated on detail responses only (db:"-"); it is not
	// part of the galleries row scan.
	Videos []GalleryVideo `json:"Videos" db:"-"`
}

// GalleryImage tracks a single image within a gallery.
type GalleryImage struct {
	ID          int        `json:"id" db:"id"`
	GalleryID   int        `json:"galleryId" db:"gallery_id"`
	URL         string     `json:"url" db:"url"`
	LocalPath   string     `json:"localPath" db:"local_path"`
	FileName    string     `json:"fileName" db:"file_name"`
	FileSize    int64      `json:"fileSize" db:"file_size"`
	Width       int        `json:"width" db:"width"`
	Height      int        `json:"height" db:"height"`
	Format      string     `json:"format" db:"format"`
	PageIndex   int        `json:"pageIndex" db:"page_index"`
	OrderIndex  int        `json:"orderIndex" db:"order_index"`
	Status      string     `json:"status" db:"status"`
	ErrorMsg    string     `json:"errorMsg" db:"error_msg"`
	CompletedAt *time.Time `json:"completedAt" db:"completed_at"`
	CreatedAt   time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time  `json:"updatedAt" db:"updated_at"`
}

// GalleryVideo tracks a single video within a gallery.
type GalleryVideo struct {
	ID          int        `json:"id" db:"id"`
	GalleryID   int        `json:"galleryId" db:"gallery_id"`
	URL         string     `json:"url" db:"url"`
	LocalPath   string     `json:"localPath" db:"local_path"`
	FileName    string     `json:"fileName" db:"file_name"`
	FileSize    int64      `json:"fileSize" db:"file_size"`
	Duration    float64    `json:"duration" db:"duration"`
	Resolution  string     `json:"resolution" db:"resolution"`
	Format      string     `json:"format" db:"format"`
	Status      string     `json:"status" db:"status"`
	ErrorMsg    string     `json:"errorMsg" db:"error_msg"`
	CompletedAt *time.Time `json:"completedAt" db:"completed_at"`
	CreatedAt   time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time  `json:"updatedAt" db:"updated_at"`
}

// GalleryDownloadInfo captures archive download metadata (ZIP/RAR).
type GalleryDownloadInfo struct {
	ID                int       `json:"id" db:"id"`
	GalleryID         int       `json:"galleryId" db:"gallery_id"`
	Title             string    `json:"title" db:"title"`
	FileCount         int       `json:"fileCount" db:"file_count"`
	FileSizeText      string    `json:"fileSizeText" db:"file_size_text"`
	ImageDimensions   string    `json:"imageDimensions" db:"image_dimensions"`
	Password          string    `json:"password" db:"password"`
	DownloadURL       string    `json:"downloadUrl" db:"download_url"`
	DownloadSource    string    `json:"downloadSource" db:"download_source"`
	OuoURL            string    `json:"ouoUrl" db:"ouo_url"`
	ResolvedDirectURL string    `json:"resolvedDirectUrl" db:"resolved_direct_url"`
	Provider          string    `json:"provider" db:"provider"`
	RequiresLogin     bool      `json:"requiresLogin" db:"requires_login"`
	RequiresEmail     bool      `json:"requiresEmail" db:"requires_email"`
	Status            string    `json:"status" db:"status"`
	LocalPath         string    `json:"localPath" db:"local_path"`
	ExtractedPath     string    `json:"extractedPath" db:"extracted_path"`
	ActualSize       int64      `json:"actualSize" db:"actual_size"`
	ZipFileName       string    `json:"zipFileName" db:"zip_file_name"`
	Parallelism       int       `json:"parallelism" db:"parallelism"`
	AvgSpeed          int       `json:"avgSpeed" db:"avg_speed"`
	VerifiedCount     int       `json:"verifiedCount" db:"verified_count"`
	CountMatched      bool      `json:"countMatched" db:"count_matched"`
	CreatedAt         time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt         time.Time `json:"updatedAt" db:"updated_at"`
}

// SniffTask records a URL sniffing operation.
type SniffTask struct {
	ID           int        `json:"ID" db:"id"`
	Seq          *string    `json:"DisplayID" db:"seq"`
	URL          string     `json:"URL" db:"url"`
	SiteID       string     `json:"SiteID" db:"site_id"`
	Status       string     `json:"Status" db:"status"`
	TotalFound   int        `json:"TotalFound" db:"total_found"`
	TotalCreated int        `json:"TotalCreated" db:"total_created"`
	TotalSkipped int        `json:"TotalSkipped" db:"total_skipped"`
	ErrorMsg     string     `json:"ErrorMsg" db:"error_msg"`
	CompletedAt  *time.Time `json:"CompletedAt" db:"completed_at"`
	CreatedAt    time.Time  `json:"CreatedAt" db:"created_at"`
	UpdatedAt    time.Time  `json:"UpdatedAt" db:"updated_at"`
}

type AppConfig struct {
	ID        int       `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// SiteAccount stores credentials and cookie state for a site login session.
type SiteAccount struct {
	ID           int        `json:"id" db:"id"`
	SiteID       string     `json:"siteId" db:"site_id"`
	Username     string     `json:"username" db:"username"`
	Password     string     `json:"password" db:"password"`
	Domain       string     `json:"domain" db:"domain"`
	Status       string     `json:"status" db:"status"`
	AuthCookies  string     `json:"authCookies" db:"auth_cookies"`
	CookiePrefix string     `json:"cookiePrefix" db:"cookie_prefix"`
	LastLoginAt  *time.Time `json:"lastLoginAt" db:"last_login_at"`
	LastUsedAt   *time.Time `json:"lastUsedAt" db:"last_used_at"`
	FailCount    int        `json:"failCount" db:"fail_count"`
	Remark       string     `json:"remark" db:"remark"`
	CreatedAt    time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time  `json:"updatedAt" db:"updated_at"`
}

// Person is a named individual in the character database.
type Person struct {
	ID           int       `json:"id" db:"id"`
	Name         string    `json:"name" db:"name"`
	Pinyin       string    `json:"pinyin" db:"pinyin"`
	Aliases      string    `json:"aliases" db:"aliases"`
	Source       string    `json:"source" db:"source"`
	SourceGame   *string    `json:"sourceGame" db:"source_game"`
	GalleryCount int       `json:"galleryCount" db:"gallery_count"`
	Confirmed    bool      `json:"confirmed" db:"confirmed"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time `json:"updatedAt" db:"updated_at"`
}

// BlocklistRule defines a keyword-based gallery filtering rule.
type BlocklistRule struct {
	ID        int       `json:"id" db:"id"`
	SiteID    string    `json:"siteId" db:"site_id"`
	FieldType string    `json:"fieldType" db:"field_type"`
	Keyword   string    `json:"keyword" db:"keyword"`
	MatchMode string    `json:"matchMode" db:"match_mode"`
	Enabled   bool      `json:"enabled" db:"enabled"`
	Remark    string    `json:"remark" db:"remark"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

type UserPreference struct {
	ID        int       `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	Category  string    `json:"category" db:"category"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// DagEvent is an append-only event sourcing record for the DAG scheduler.
type DagEvent struct {
	ID        int       `json:"id" db:"id"`
	Seq       int       `json:"seq" db:"seq"`
	DagID     string    `json:"dagId" db:"dag_id"`
	NodeID    *string   `json:"nodeId" db:"node_id"`
	Type      string    `json:"type" db:"type"`
	Payload   string    `json:"payload" db:"payload"`
	Timestamp time.Time `json:"timestamp" db:"timestamp"`
}

// DagSnapshot is a periodic state checkpoint for a DAG instance.
type DagSnapshot struct {
	ID        int       `json:"id" db:"id"`
	DagID     string    `json:"dagId" db:"dag_id"`
	State     string    `json:"state" db:"state"`
	LastSeq   int       `json:"lastSeq" db:"last_seq"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// DownloadHistory records completed downloads for deduplication.
type DownloadHistory struct {
	ID          string    `json:"id" db:"id"`
	SiteID      string    `json:"siteId" db:"site_id"`
	GalleryID   int       `json:"galleryId" db:"gallery_id"`
	URL         string    `json:"url" db:"url"`
	Status      string    `json:"status" db:"status"`
	ImageCount  int       `json:"imageCount" db:"image_count"`
	VideoCount  int       `json:"videoCount" db:"video_count"`
	Title       string    `json:"title" db:"title"`
	Protagonist string    `json:"protagonist" db:"protagonist"`
	SavePath    string    `json:"savePath" db:"save_path"`
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

// SiteConfigRecord stores runtime-overridable site provider configuration.
type SiteConfigRecord struct {
	SiteID              string    `json:"siteId" db:"site_id"`
	CookiePrefix        string    `json:"cookiePrefix" db:"cookie_prefix"`
	CdnDomains          string    `json:"cdnDomains" db:"cdn_domains"`
	UrlPatterns         string    `json:"urlPatterns" db:"url_patterns"`
	BlockedKeywords     string    `json:"blockedKeywords" db:"blocked_keywords"`
	BlockedCategories   string    `json:"blockedCategories" db:"blocked_categories"`
	BlockedProtagonists string    `json:"blockedProtagonists" db:"blocked_protagonists"`
	PublisherPrefixes   string    `json:"publisherPrefixes" db:"publisher_prefixes"`
	AgeVerifyConfig     string    `json:"ageVerifyConfig" db:"age_verify_config"`
	CategoryLabels      string    `json:"categoryLabels" db:"category_labels"`
	TitleCleanPatterns  string    `json:"titleCleanPatterns" db:"title_clean_patterns"`
	TitleSuffixPatterns string    `json:"titleSuffixPatterns" db:"title_suffix_patterns"`
	UpdatedAt           time.Time `json:"updatedAt" db:"updated_at"`
}

// SjsBookmark stores a saved SJS forum thread.
type SjsBookmark struct {
	ID           int       `json:"id" db:"id"`
	URL          string    `json:"url" db:"url"`
	ThreadID     string    `json:"threadId" db:"thread_id"`
	Title        string    `json:"title" db:"title"`
	CoverURL     string    `json:"coverUrl" db:"cover_url"`
	Author       string    `json:"author" db:"author"`
	PostDate     string    `json:"postDate" db:"post_date"`
	ForumSection string    `json:"forumSection" db:"forum_section"`
	Notes        string    `json:"notes" db:"notes"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time `json:"updatedAt" db:"updated_at"`
}
