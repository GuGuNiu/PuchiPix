package sites

import (
	"context"
	"time"
)

// GalleryImageItem represents a single image within a scraped gallery,
// carrying its source URL and positional metadata for ordered download.
type GalleryImageItem struct {
	URL       string `json:"url"`
	PageIndex int    `json:"pageIndex"`
	OrderIndex int   `json:"orderIndex"`
}

// GalleryVideoItem represents a single video URL discovered during scraping.
type GalleryVideoItem struct {
	URL string `json:"url"`
}

// GalleryZipInfo captures archive download metadata extracted from gallery
// pages, enabling the downloader to resolve passwords and relay URLs.
type GalleryZipInfo struct {
	Title          string `json:"title"`
	FileCount      int    `json:"fileCount"`
	FileSizeText   string `json:"fileSizeText"`
	ImageDimensions string `json:"imageDimensions"`
	Password       string `json:"password"`
	DownloadURL    string `json:"downloadUrl"`
	Provider       string `json:"provider"`
	RequiresLogin  bool   `json:"requiresLogin"`
	RequiresEmail  bool   `json:"requiresEmail"`
	DownloadSource string `json:"downloadSource,omitempty"`
	OuoURL         string `json:"ouoUrl,omitempty"`
}

// GalleryScrapeResult is the unified output of all gallery providers,
// aggregating metadata, images, videos, and optional archive info.
type GalleryScrapeResult struct {
	SourceURL       string             `json:"sourceUrl"`
	Title           string             `json:"title"`
	Protagonist     string             `json:"protagonist"`
	Description     string             `json:"description"`
	Category        string             `json:"category"`
	Tags            []string           `json:"tags"`
	CoverURL        string             `json:"coverUrl"`
	PublishTime     string             `json:"publishTime,omitempty"`
	Images          []GalleryImageItem `json:"images"`
	Videos          []GalleryVideoItem `json:"videos"`
	PageCount       int                `json:"pageCount"`
	ImageCount      int                `json:"imageCount"`
	VideoCount      int                `json:"videoCount"`
	ScrapedDomain   string             `json:"scrapedDomain,omitempty"`
	ZipInfo         *GalleryZipInfo    `json:"zipInfo,omitempty"`
	GameCharacters  []string           `json:"gameCharacters,omitempty"`
	NeedsPurchase   bool               `json:"needsPurchase,omitempty"`
	DownloadLinks   []string           `json:"downloadLinks,omitempty"`
}

// M3U8Candidate represents a discovered M3U8 URL with a guessed title,
// allowing the user to choose among multiple streams found on a page.
type M3U8Candidate struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// ScrapeResult is the output of video-page scraping, carrying the M3U8
// URL and metadata needed to create a download task.
type ScrapeResult struct {
	M3U8URL        string           `json:"m3u8_url"`
	M3U8Candidates []M3U8Candidate  `json:"m3u8_candidates,omitempty"`
	Title          string           `json:"title"`
	PageURL        string           `json:"page_url"`
	Tags           []string         `json:"tags"`
	Actors         []string         `json:"actors"`
	Categories     []string         `json:"categories"`
	Director       string           `json:"director"`
}

// SiteSearchResult represents a single entry from a listing or search page.
type SiteSearchResult struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	CoverURL string `json:"coverUrl,omitempty"`
	Date     string `json:"date,omitempty"`
}

// BlockCheckResult reports whether content was blocked and why.
type BlockCheckResult struct {
	Blocked bool   `json:"blocked"`
	Reason  string `json:"reason,omitempty"`
}

// ExtendedMetadata enriches basic site metadata with categories, director,
// series, and block-check status for gallery providers.
type ExtendedMetadata struct {
	Title       string         `json:"title"`
	Tags        []string       `json:"tags"`
	Actors      []string       `json:"actors"`
	Categories  []string       `json:"categories"`
	Director    string         `json:"director"`
	Series      []SeriesItem   `json:"series"`
	Blocked     bool           `json:"blocked"`
	BlockReason string         `json:"blockReason,omitempty"`
}

// SeriesItem represents a related series entry discovered during scraping.
type SeriesItem struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	ID    string `json:"id"`
}

// CookieData represents a single browser cookie for persistent sessions.
type CookieData struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	HTTPOnly bool   `json:"httpOnly"`
	Secure   bool   `json:"secure"`
	SameSite string `json:"sameSite"`
	Expires  int64  `json:"expires,omitempty"`
}

// BlocklistChecker abstracts the blocklist service for providers that
// need to check user-defined content filtering rules.
type BlocklistChecker interface {
	CheckUserRules(ctx context.Context, siteID string, fields map[string]string) (BlockCheckResult, error)
}

// GallerySiteProvider defines the interface for site-specific gallery
// scraping and metadata extraction, mirroring the TypeScript counterpart.
type GallerySiteProvider interface {
	SiteID() string
	CanHandle(url string) bool
	ScrapeGallery(ctx context.Context, url string) (*GalleryScrapeResult, error)
	ScrapeGalleryHTTP(ctx context.Context, url string) (*GalleryScrapeResult, error)
	Search(ctx context.Context, query string, page int) ([]SiteSearchResult, error)
}

// SiteProvider extends GallerySiteProvider with video-scraping and
// block-check capabilities, covering the full SiteProvider contract.
type SiteProvider interface {
	GallerySiteProvider

	BuildSearchURL(keyword string) string
	CleanTitle(rawTitle string) string
	CheckContentBlocked(title, category string, protagonist string) BlockCheckResult
	NormalizeURL(url string) string
	IsListingPage(url string) bool
}

// SiteConfig holds static configuration for a registered site provider.
type SiteConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	Enabled bool   `json:"enabled"`
}

// BadgeTheme defines the visual styling for a site's UI badge.
type BadgeTheme struct {
	Gradient   string `json:"gradient"`
	SolidColor string `json:"solidColor"`
	TextColor  string `json:"textColor"`
}

// SiteInfo aggregates display metadata for a site, combining config
// with badge styling and type classification.
type SiteInfo struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	NameCn  string     `json:"nameCn"`
	NameEn  string     `json:"nameEn"`
	BaseURL string     `json:"baseUrl"`
	Enabled bool       `json:"enabled"`
	Type    string     `json:"type"`
	Badge   BadgeTheme `json:"badge"`
	Gallery bool       `json:"gallery"`
	Domains []string   `json:"domains,omitempty"`
}

// SiteModuleConfig defines a site's registration data, loaded from the
// site-modules configuration and used to initialize the SiteRegistry.
type SiteModuleConfig struct {
	ID               string     `json:"id"`
	NameCn           string     `json:"nameCn"`
	NameEn           string     `json:"nameEn"`
	BaseURL          string     `json:"baseUrl"`
	Type             string     `json:"type"`
	Badge            BadgeTheme `json:"badge"`
	Enabled          bool       `json:"enabled"`
	Domains          []string   `json:"domains,omitempty"`
	ScrapingStrategy string     `json:"scrapingStrategy,omitempty"`
}

// AccountStatus tracks the lifecycle of a site login session.
type AccountStatus string

const (
	AccountStatusActive    AccountStatus = "active"
	AccountStatusDisabled  AccountStatus = "disabled"
	AccountStatusCooldown  AccountStatus = "cooldown"
	AccountStatusExpired   AccountStatus = "expired"
	AccountStatusBanned    AccountStatus = "banned"
)

// AccountInfo is the read-only view of a SiteAccount, hiding the
// raw cookie JSON from consumers that only need status metadata.
type AccountInfo struct {
	ID           int            `json:"id"`
	SiteID       string         `json:"siteId"`
	Username     string         `json:"username"`
	Domain       string         `json:"domain"`
	Status       AccountStatus  `json:"status"`
	CookiePrefix string         `json:"cookiePrefix"`
	LastLoginAt  *time.Time     `json:"lastLoginAt"`
	LastUsedAt   *time.Time     `json:"lastUsedAt"`
	FailCount    int            `json:"failCount"`
	Remark       string         `json:"remark"`
	HasCookies   bool           `json:"hasCookies"`
}
