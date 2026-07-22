package xsnvshen

import (
	"regexp"
	"strings"

	"backend/internal/sites"
)

var SiteDomains []string

var (
	ImgCdnDomain    string
	ResCdnDomain    string
	AgeVerifyField  string
	AgeVerifyValue  string
	AgeVerifyCookie string
)

var BlockedTitleKeywords []string
var BlockedCategories []string
var BlockedProtagonists []string
var BlockedProtagonistsEnabled bool

var pkgDataStore sites.SiteDataStore

var (
	albumIDPattern   = regexp.MustCompile(`/album/(\d+)`)
	modelIDPattern   = regexp.MustCompile(`/album/(\d+)/(\d+)/`)
	siteSuffixPattern = regexp.MustCompile(`(?i)\s*[_|]\s*(秀色女神|xsnvshen|XsNvShen)\s*$`)
	publisherPrefix   = regexp.MustCompile(`^[\x{4e00}-\x{9fff}]{3,8}[:]\s*`)
	bracketPrefix     = regexp.MustCompile(`^\[.*?\]\s*`)
	trailingSeparator = regexp.MustCompile(`(?i)\s*[-\s]*$`)
	datePattern       = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})`)
	descCountPattern  = regexp.MustCompile(`(?i)\s*\d+P\d*V?\s*$`)
)

// GalleryPageMetadata holds parsed data from a gallery album page.
type GalleryPageMetadata struct {
	H1Title     string
	RawTitle    string
	Tags        []string
	Category    string
	CoverURL    string
	PublishTime string
	ModelID     string
	AlbumID     string
	Images      []GalleryImageEntry
}

// GalleryImageEntry represents a single image URL with its page index.
type GalleryImageEntry struct {
	URL       string
	PageIndex int
}

// initData populates package-level configuration variables from the
// unified SiteDataStore, replacing former hardcoded constants.
func initData(ds sites.SiteDataStore) {
	pkgDataStore = ds

	if mod, ok := ds.GetModuleConfig("xsnvshen"); ok {
		SiteDomains = mod.Domains
	}

	pd, ok := ds.GetProviderData("xsnvshen")
	if !ok {
		return
	}

	ImgCdnDomain = pd.ImgCdnDomain
	ResCdnDomain = pd.ResCdnDomain
	AgeVerifyField = pd.AgeVerifyField
	AgeVerifyValue = pd.AgeVerifyValue
	AgeVerifyCookie = pd.AgeVerifyCookie

	BlockedTitleKeywords = pd.BlockedTitleKeywords
	BlockedCategories = pd.BlockedCategories
	BlockedProtagonists = pd.BlockedProtagonists
	BlockedProtagonistsEnabled = pd.BlockedProtagonistsEnabled
}

// ExtractAlbumID extracts the numeric album ID from a URL path.
func ExtractAlbumID(rawURL string) string {
	if m := albumIDPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractModelIDFromImageUrl extracts the model ID and album ID from
// an image URL path segment.
func ExtractModelIDFromImageUrl(rawURL string) (string, string) {
	if m := modelIDPattern.FindStringSubmatch(rawURL); len(m) >= 3 {
		return m[1], m[2]
	}
	return "", ""
}

// MatchesXsnvshenURL checks if a URL belongs to xsnvshen.co or .com.
func MatchesXsnvshenURL(rawURL string) bool {
	if pkgDataStore == nil {
		return false
	}
	return pkgDataStore.CanHandle("xsnvshen", rawURL)
}

// CleanTitle removes bracket prefixes, publisher prefixes, and site
// suffixes from a raw title string.
func CleanTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	title = bracketPrefix.ReplaceAllString(title, "")
	title = publisherPrefix.ReplaceAllString(title, "")
	title = siteSuffixPattern.ReplaceAllString(title, "")
	title = trailingSeparator.ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}

// CleanDescription removes the protagonist name from the title,
// strips leading separators, and trims trailing image-count suffixes
// like "73P" or "100P2V" to produce a concise description.
func CleanDescription(title, protagonist string) string {
	if title == "" {
		return ""
	}
	if protagonist == "" {
		return title
	}
	desc := strings.ReplaceAll(title, protagonist, "")
	desc = strings.TrimLeft(desc, " \t-")
	desc = descCountPattern.ReplaceAllString(desc, "")
	return strings.TrimSpace(desc)
}

// ReplaceDomain swaps the domain in a URL to the target base URL.
func ReplaceDomain(rawURL, baseDomain string) string {
	if rawURL == "" || baseDomain == "" {
		return rawURL
	}
	for _, domain := range SiteDomains {
		if strings.HasPrefix(rawURL, domain) {
			return baseDomain + rawURL[len(domain):]
		}
	}
	return rawURL
}

// ExtractDomainFromUrl extracts the scheme+host portion of a URL.
func ExtractDomainFromUrl(rawURL string) string {
	for _, domain := range SiteDomains {
		if strings.HasPrefix(rawURL, domain) {
			return domain
		}
	}
	return ""
}

// IsListingPage reports whether the URL is a listing or search page
// rather than an album detail page.
func IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/album/")
}

// NormalizeURL ensures URL protocol completeness.
func NormalizeURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	return rawURL
}
