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

var (
	albumIDPattern    = regexp.MustCompile(`/album/(\d+)`)
	modelIDPattern    = regexp.MustCompile(`/album/(\d+)/(\d+)/`)
	siteSuffixPattern = regexp.MustCompile(`(?i)\s*[_|]\s*(秀色女神|xsnvshen|XsNvShen)\s*$`)
	publisherPrefix   = regexp.MustCompile(`^[\x{4e00}-\x{9fff}]{3,8}[:]\s*`)
	bracketPrefix     = regexp.MustCompile(`^\[.*?\]\s*`)
	trailingSeparator = regexp.MustCompile(`(?i)\s*[-\s]*$`)
	datePattern       = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})`)
	descCountPattern  = regexp.MustCompile(`(?i)\s*\d+P\d*V?\s*$`)

	xiuRenPrefixPattern = regexp.MustCompile(`^\[.*?\]高清写真图\s+\d{4}\.\d{2}\.\d{2}\s+No\.\d+\s*`)
	xiuRenSuffixPattern = regexp.MustCompile(`\s*秀人网.*$`)
	descModelPattern    = regexp.MustCompile(`模特[@:：]\s*(\S+)`)
)

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
	Protagonist string
}

type GalleryImageEntry struct {
	URL       string
	PageIndex int
}

// initData loads the site configuration into the package-level variables so
// the rest of the package can read them without a data store handle.
func initData(ds sites.SiteDataStore) {
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

func ExtractAlbumID(rawURL string) string {
	if m := albumIDPattern.FindStringSubmatch(rawURL); len(m) >= 2 {
		return m[1]
	}
	return ""
}

// ExtractModelIDFromImageUrl returns the model ID and album ID parsed from
// an image URL path segment.
func ExtractModelIDFromImageUrl(rawURL string) (string, string) {
	if m := modelIDPattern.FindStringSubmatch(rawURL); len(m) >= 3 {
		return m[1], m[2]
	}
	return "", ""
}

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

func CleanTitleXsnvshen(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	title = xiuRenPrefixPattern.ReplaceAllString(title, "")
	title = xiuRenSuffixPattern.ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}

// ExtractModelFromDescription reads the model name from a meta description,
// which the site writes as a "model@name" or "model:name" pair.
func ExtractModelFromDescription(desc string) string {
	if m := descModelPattern.FindStringSubmatch(desc); len(m) >= 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// CleanDescription strips the protagonist name, leading separators, and the
// trailing image-count suffix (e.g. 73P, 100P2V) from a title.
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

func ExtractDomainFromUrl(rawURL string) string {
	for _, domain := range SiteDomains {
		if strings.HasPrefix(rawURL, domain) {
			return domain
		}
	}
	return ""
}

func IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/album/")
}

func NormalizeURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	return rawURL
}
