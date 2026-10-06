package exhentai

import (
	"html"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"backend/internal/sites"
)

var (
	BaseEURL  string
	BaseExURL string

	ImageBatchSize    int
	ImageFetchTimeout int
	ThumbsPerPage     int
)

var SiteDomains []string

var CategoryLabels map[string]int
var CategoryNames map[int]string

// initData loads the site configuration into the package-level variables so
// the rest of the package can read them without a data store handle.
func initData(ds sites.SiteDataStore) {
	if mod, ok := ds.GetModuleConfig("exhentai"); ok {
		SiteDomains = mod.Domains
	}

	pd, ok := ds.GetProviderData("exhentai")
	if !ok {
		return
	}

	BaseEURL = pd.BaseEURL
	BaseExURL = pd.BaseExURL
	ImageBatchSize = pd.ImageBatchSize
	ImageFetchTimeout = pd.ImageFetchTimeout
	ThumbsPerPage = pd.ThumbsPerPage
	CategoryLabels = pd.CategoryLabels

	CategoryNames = make(map[int]string, len(pd.CategoryNames))
	for k, v := range pd.CategoryNames {
		if n, err := strconv.Atoi(k); err == nil {
			CategoryNames[n] = v
		}
	}
}

// ExhentaiCookies holds the IPB authentication tokens required to
// access ExHentai, which otherwise returns a blank "sad panda" page.
type ExhentaiCookies struct {
	IPBMemberID string
	IPBPassHash string
	Igneous     string
}

// GetExhentaiCookies reads authentication cookies from environment
// variables, returning nil when the mandatory IPB pair is incomplete.
func GetExhentaiCookies() *ExhentaiCookies {
	ipbMemberID := os.Getenv("EXHENTAI_IPB_MEMBER_ID")
	ipbPassHash := os.Getenv("EXHENTAI_IPB_PASS_HASH")
	igneous := os.Getenv("EXHENTAI_IGNEOUS")

	if ipbMemberID == "" || ipbPassHash == "" {
		return nil
	}

	return &ExhentaiCookies{
		IPBMemberID: ipbMemberID,
		IPBPassHash: ipbPassHash,
		Igneous:     igneous,
	}
}

func (c *ExhentaiCookies) AsCookieString() string {
	parts := []string{
		"ipb_member_id=" + c.IPBMemberID,
		"ipb_pass_hash=" + c.IPBPassHash,
	}
	if c.Igneous != "" {
		parts = append(parts, "igneous="+c.Igneous)
	}
	return strings.Join(parts, "; ")
}

// HasExCookies reports whether restricted-site access is configured.
func HasExCookies() bool {
	return GetExhentaiCookies() != nil
}

var galleryIDPattern = regexp.MustCompile(`/g/(\d+)/`)

func ExtractGalleryID(rawURL string) string {
	m := galleryIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

var galleryTokenPattern = regexp.MustCompile(`/g/\d+/([a-f0-9]+)/`)

// ExtractGalleryToken returns the per-gallery hash token embedded in the URL.
func ExtractGalleryToken(rawURL string) string {
	m := galleryTokenPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

// NormalizeToEhentai rewrites an ExHentai URL to e-hentai.org so
// requests can succeed even without ExHentai cookie authentication.
func NormalizeToEhentai(rawURL string) string {
	if BaseEURL == "" || BaseExURL == "" {
		return rawURL
	}
	return strings.ReplaceAll(rawURL, BaseExURL, BaseEURL)
}

// CleanExhentaiTitle decodes the HTML entities the site embeds in titles.
func CleanExhentaiTitle(rawTitle string) string {
	if rawTitle == "" {
		return ""
	}
	title := strings.TrimSpace(rawTitle)
	title = html.UnescapeString(title)
	return strings.TrimSpace(title)
}

func IsExhentaiListingPage(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(parsed.Path, "/g/")
}

// GetAdaptiveURLs lists the public-domain gallery URL first, appending the
// restricted-domain variant only when authentication cookies are present.
func GetAdaptiveURLs(rawURL string) []string {
	galleryID := ExtractGalleryID(rawURL)
	if galleryID == "" {
		return []string{rawURL}
	}

	token := ExtractGalleryToken(rawURL)
	if token == "" {
		return []string{rawURL}
	}

	urls := []string{BaseEURL + "/g/" + galleryID + "/" + token + "/"}
	if HasExCookies() {
		urls = append(urls, BaseExURL+"/g/"+galleryID+"/"+token+"/")
	}
	return urls
}

// GetAdaptiveSearchURLs queries the restricted domain as well when
// authentication cookies are present.
func GetAdaptiveSearchURLs(keyword string) []string {
	params := "f_search=" + url.QueryEscape(keyword) + "&advsearch=1&f_srdd=0&f_cats=0"
	urls := []string{BaseEURL + "/?" + params}
	if HasExCookies() {
		urls = append(urls, BaseExURL+"/?"+params)
	}
	return urls
}
