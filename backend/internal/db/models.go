package db

import "time"

// DownloadTask represents a video download task (m3u8/mp4) with
// progress tracking and priority scheduling support.
type DownloadTask struct {
	ID        int       `json:"id" db:"id"`
	URL       string    `json:"url" db:"url"`
	M3U8URL   string    `json:"m3u8Url" db:"m3u8_url"`
	Status    string    `json:"status" db:"status"`
	Progress  float64   `json:"progress" db:"progress"`
	FilePath  string    `json:"filePath" db:"file_path"`
	Format    string    `json:"format" db:"format"`
	Priority  int       `json:"priority" db:"priority"`
	ErrorMsg  string    `json:"errorMsg" db:"error_msg"`
	Seq       *string   `json:"seq" db:"seq"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// VideoInfo stores metadata extracted from a download task's source URL.
type VideoInfo struct {
	ID         int       `json:"id" db:"id"`
	TaskID     int       `json:"taskId" db:"task_id"`
	Title      string    `json:"title" db:"title"`
	SourceURL  string    `json:"sourceUrl" db:"source_url"`
	FileSize   int64     `json:"fileSize" db:"file_size"`
	Duration   float64   `json:"duration" db:"duration"`
	Tags       string    `json:"tags" db:"tags"`
	Actors     string    `json:"actors" db:"actors"`
	Categories string    `json:"categories" db:"categories"`
	Director   string    `json:"director" db:"director"`
	Resolution string    `json:"resolution" db:"resolution"`
	CreatedAt  time.Time `json:"createdAt" db:"created_at"`
}

// Gallery is the central model for a multi-site image/video collection,
// linking images, videos, and download metadata through a 1-to-many
// and 1-to-1 relationship respectively.
type Gallery struct {
	ID                  int        `json:"id" db:"id"`
	Seq                 *string    `json:"seq" db:"seq"`
	SourceURL           string     `json:"sourceUrl" db:"source_url"`
	SiteID              string     `json:"siteId" db:"site_id"`
	ScrapedDomain       string     `json:"scrapedDomain" db:"scraped_domain"`
	Title               string     `json:"title" db:"title"`
	Protagonist         string     `json:"protagonist" db:"protagonist"`
	Description         string     `json:"description" db:"description"`
	Category            string     `json:"category" db:"category"`
	Tags                string     `json:"tags" db:"tags"`
	CoverURL            string     `json:"coverUrl" db:"cover_url"`
	CoverLocalPath      string     `json:"coverLocalPath" db:"cover_local_path"`
	ImageCount          int        `json:"imageCount" db:"image_count"`
	VideoCount          int        `json:"videoCount" db:"video_count"`
	PageCount           int        `json:"pageCount" db:"page_count"`
	Status              string     `json:"status" db:"status"`
	ErrorMsg            string     `json:"errorMsg" db:"error_msg"`
	DownloadMethod      string     `json:"downloadMethod" db:"download_method"`
	ExpectedImageCount  int        `json:"expectedImageCount" db:"expected_image_count"`
	ExpectedVideoCount  int        `json:"expectedVideoCount" db:"expected_video_count"`
	ContentVerified     bool       `json:"contentVerified" db:"content_verified"`
	SavePath            string     `json:"savePath" db:"save_path"`
	TotalSize           int64      `json:"totalSize" db:"total_size"`
	DownloadedSize      int64      `json:"downloadedSize" db:"downloaded_size"`
	GameCharacters      *string    `json:"gameCharacters" db:"game_characters"`
	PublishTime         *string    `json:"publishTime" db:"publish_time"`
	ScrapedAt           *time.Time `json:"scrapedAt" db:"scraped_at"`
	CompletedAt         *time.Time `json:"completedAt" db:"completed_at"`
	CreatedAt           time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt           time.Time  `json:"updatedAt" db:"updated_at"`
}

// GalleryImage tracks a single image within a gallery, including
// download status and dimensions for content verification.
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

// GalleryVideo tracks a single video within a gallery, including
// resolution and format for downstream transcoding decisions.
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

// GalleryDownloadInfo captures archive download metadata (ZIP/RAR),
// including password, OUO relay resolution, and verification state.
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

// SniffTask records a URL sniffing operation that discovers gallery
// URLs from a listing page, tracking found/created/skipped counts.
type SniffTask struct {
	ID           int        `json:"id" db:"id"`
	Seq          *string    `json:"seq" db:"seq"`
	URL          string     `json:"url" db:"url"`
	SiteID       string     `json:"siteId" db:"site_id"`
	Status       string     `json:"status" db:"status"`
	TotalFound   int        `json:"totalFound" db:"total_found"`
	TotalCreated int        `json:"totalCreated" db:"total_created"`
	TotalSkipped int        `json:"totalSkipped" db:"total_skipped"`
	ErrorMsg     string     `json:"errorMsg" db:"error_msg"`
	CompletedAt  *time.Time `json:"completedAt" db:"completed_at"`
	CreatedAt    time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time  `json:"updatedAt" db:"updated_at"`
}

// AppConfig is a key-value store for application-level settings.
type AppConfig struct {
	ID        int       `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// SiteAccount stores credentials and cookie state for a site-specific
// login session, supporting multi-account rotation and fail tracking.
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

// Person is a named individual in the character database, supporting
// pinyin-based fuzzy matching and alias resolution.
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

// BlocklistRule defines a keyword-based filtering rule that excludes
// galleries matching specific field/mode criteria.
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

// UserPreference stores per-user settings grouped by category.
type UserPreference struct {
	ID        int       `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	Category  string    `json:"category" db:"category"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// DagEvent is an append-only event sourcing record for the DAG
// scheduler, enabling state reconstruction via event replay.
type DagEvent struct {
	ID        int       `json:"id" db:"id"`
	Seq       int       `json:"seq" db:"seq"`
	DagID     string    `json:"dagId" db:"dag_id"`
	NodeID    *string   `json:"nodeId" db:"node_id"`
	Type      string    `json:"type" db:"type"`
	Payload   string    `json:"payload" db:"payload"`
	Timestamp time.Time `json:"timestamp" db:"timestamp"`
}

// DagSnapshot is a periodic state checkpoint for a DAG instance,
// allowing fast recovery without full event replay.
type DagSnapshot struct {
	ID        int       `json:"id" db:"id"`
	DagID     string    `json:"dagId" db:"dag_id"`
	State     string    `json:"state" db:"state"`
	LastSeq   int       `json:"lastSeq" db:"last_seq"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// DownloadHistory records completed downloads for deduplication and
// user-facing history views across sites.
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

// SiteConfigRecord stores runtime-overridable site provider configuration,
// supplementing the static JSON defaults with DB-backed variable data.
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

// SjsBookmark stores a saved forum thread from the SJS site with
// metadata for browsing and re-access.
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
