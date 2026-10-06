package sites

import (
	"context"
	"time"
)

type GalleryImageItem struct {
	URL        string `json:"url"`
	PageIndex  int    `json:"pageIndex"`
	OrderIndex int    `json:"orderIndex"`
}

type GalleryVideoItem struct {
	URL string `json:"url"`
}

type GalleryZipInfo struct {
	Title           string `json:"title"`
	FileCount       int    `json:"fileCount"`
	FileSizeText    string `json:"fileSizeText"`
	ImageDimensions string `json:"imageDimensions"`
	Password        string `json:"password"`
	DownloadURL     string `json:"downloadUrl"`
	Provider        string `json:"provider"`
	RequiresLogin   bool   `json:"requiresLogin"`
	RequiresEmail   bool   `json:"requiresEmail"`
	DownloadSource  string `json:"downloadSource,omitempty"`
	OuoURL          string `json:"ouoUrl,omitempty"`
}

type GalleryScrapeResult struct {
	SourceURL      string             `json:"sourceUrl"`
	Title          string             `json:"title"`
	Protagonist    string             `json:"protagonist"`
	Description    string             `json:"description"`
	Category       string             `json:"category"`
	Tags           []string           `json:"tags"`
	CoverURL       string             `json:"coverUrl"`
	PublishTime    string             `json:"publishTime,omitempty"`
	Images         []GalleryImageItem `json:"images"`
	Videos         []GalleryVideoItem `json:"videos"`
	PageCount      int                `json:"pageCount"`
	ImageCount     int                `json:"imageCount"`
	VideoCount     int                `json:"videoCount"`
	ScrapedDomain  string             `json:"scrapedDomain,omitempty"`
	ZipInfo        *GalleryZipInfo    `json:"zipInfo,omitempty"`
	GameCharacters []string           `json:"gameCharacters,omitempty"`
	NeedsPurchase  bool               `json:"needsPurchase,omitempty"`
	DownloadLinks  []string           `json:"downloadLinks,omitempty"`
}

// M3U8Candidate is one stream discovered on a page, offered to the user
// when several are present.
type M3U8Candidate struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

type ScrapeResult struct {
	M3U8URL        string          `json:"m3u8_url"`
	M3U8Candidates []M3U8Candidate `json:"m3u8_candidates,omitempty"`
	Title          string          `json:"title"`
	PageURL        string          `json:"page_url"`
	Tags           []string        `json:"tags"`
	Actors         []string        `json:"actors"`
	Categories     []string        `json:"categories"`
	Director       string          `json:"director"`
}

type SiteSearchResult struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	CoverURL string `json:"coverUrl,omitempty"`
	Date     string `json:"date,omitempty"`
}

type BlockCheckResult struct {
	Blocked bool   `json:"blocked"`
	Reason  string `json:"reason,omitempty"`
}

type ExtendedMetadata struct {
	Title       string       `json:"title"`
	Tags        []string     `json:"tags"`
	Actors      []string     `json:"actors"`
	Categories  []string     `json:"categories"`
	Director    string       `json:"director"`
	Series      []SeriesItem `json:"series"`
	Blocked     bool         `json:"blocked"`
	BlockReason string       `json:"blockReason,omitempty"`
}

type SeriesItem struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	ID    string `json:"id"`
}

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

// GallerySiteProvider defines the gallery scraping and metadata extraction
// contract implemented by every site-specific provider.
type GallerySiteProvider interface {
	SiteID() string
	CanHandle(url string) bool
	ScrapeGallery(ctx context.Context, url string) (*GalleryScrapeResult, error)
	ScrapeGalleryHTTP(ctx context.Context, url string) (*GalleryScrapeResult, error)
	Search(ctx context.Context, query string, page int) ([]SiteSearchResult, error)
}

// SiteProvider extends GallerySiteProvider with search URL building, title
// cleaning, content blocking, and URL normalization.
type SiteProvider interface {
	GallerySiteProvider

	BuildSearchURL(keyword string) string
	CleanTitle(rawTitle string) string
	CheckContentBlocked(title, category string, protagonist string) BlockCheckResult
	NormalizeURL(url string) string
	IsListingPage(url string) bool
}

// VideoDetailProvider is an optional interface implemented by providers for
// sites that server-render their video player configuration, so the stream
// URL and the full metadata set can be read over plain HTTP without driving
// a browser.
//
// The video pipeline consults this before falling back to the universal
// browser sniffer. Sites that implement it get their own tag, category and
// actor selectors instead of the universal heuristics, which only understand
// MacCMS-style vod_class/keyword markup.
type VideoDetailProvider interface {
	// ScrapeVideoDetail identifies the stream URL and full metadata of a
	// single video detail page. M3U8Candidates is populated when the page
	// offers more than one quality.
	ScrapeVideoDetail(ctx context.Context, pageURL string) (*ScrapeResult, error)
}

type BadgeTheme struct {
	Gradient   string `json:"gradient"`
	SolidColor string `json:"solidColor"`
	TextColor  string `json:"textColor"`
}

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

type AccountStatus string

const (
	AccountStatusActive   AccountStatus = "active"
	AccountStatusDisabled AccountStatus = "disabled"
	AccountStatusCooldown AccountStatus = "cooldown"
	AccountStatusExpired  AccountStatus = "expired"
	AccountStatusBanned   AccountStatus = "banned"
)

// AccountInfo is the read-only view of a SiteAccount, hiding the
// raw cookie JSON from consumers that only need status metadata.
type AccountInfo struct {
	ID           int           `json:"id"`
	SiteID       string        `json:"siteId"`
	Username     string        `json:"username"`
	Domain       string        `json:"domain"`
	Status       AccountStatus `json:"status"`
	CookiePrefix string        `json:"cookiePrefix"`
	LastLoginAt  *time.Time    `json:"lastLoginAt"`
	LastUsedAt   *time.Time    `json:"lastUsedAt"`
	FailCount    int           `json:"failCount"`
	Remark       string        `json:"remark"`
	HasCookies   bool          `json:"hasCookies"`
}
