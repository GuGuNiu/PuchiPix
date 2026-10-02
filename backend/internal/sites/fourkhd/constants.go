package fourkhd

import (
	"fmt"
	"regexp"
	"strings"
)

type GalleryPageMetadata struct {
	H1Title     string
	RawTitle    string
	Tags        []string
	Category    string
	CoverURL    string
	PublishTime string
	CurrentPage int
	TotalPages  int
	Images      []GalleryImageEntry
}

type GalleryImageEntry struct {
	URL       string
	PageIndex int
}

// DownloadInfo holds TeraBox download metadata extracted from the page.
type DownloadInfo struct {
	Password    string
	DownloadURL string
	FileSize    string
	FileCount   int
	Provider    string
}

var (
	contentIDPattern = regexp.MustCompile(`/content/(\d+)/([^/]+)\.html`)
	pageNumPattern   = regexp.MustCompile(`\.html/(\d+)(?:/|$)`)

	titleSizePattern = regexp.MustCompile(`\[(\d+(?:\.\d+)?(?:MB|GB))-(\d+)photos\]`)

	imageURLPattern = regexp.MustCompile(`https?://[^\s"'<>]*4khd\.com[^\s"'<>]*\.(?:webp|jpg|png|jpeg)[^\s"'<>]*`)

	pageLinkPattern = regexp.MustCompile(`href="([^"]*\.html/(\d+))"`)

	downloadLinkPattern = regexp.MustCompile(`href="(https://m\.4khd\.com/[^"]+)"`)

	passwordPattern = regexp.MustCompile(`Extracting passwords:\s*</p>\s*<p[^>]*>(.+?)</p>`)

	publishTimePattern = regexp.MustCompile(`<meta property="article:published_time" content="([^"]+)"`)

	canonicalPattern = regexp.MustCompile(`<link rel="canonical" href="([^"]+)"`)

	authorPattern = regexp.MustCompile(`<meta name="author" content="([^"]+)"`)

	relatedPattern = regexp.MustCompile(`<a href="(https://www\.4khd\.com/content/[^"]+)"><img[^>]*src="([^"]*)"[^>]*><p>(.+?)</p></a>`)
)

// ExtractContentID returns the category ID and slug parsed from a detail page URL.
func ExtractContentID(rawURL string) (category, slug string) {
	m := contentIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 3 {
		return m[1], m[2]
	}
	return "", ""
}

// ExtractPageNum returns 0 when the URL is not a paginated form.
func ExtractPageNum(rawURL string) int {
	m := pageNumPattern.FindStringSubmatch(rawURL)
	if len(m) >= 2 {
		n := 0
		for _, c := range m[1] {
			if c >= '0' && c <= '9' {
				n = n*10 + int(c-'0')
			}
		}
		return n
	}
	return 0
}

func BuildPageURL(baseURL string, page int) string {
	return baseURL + "/" + itoa(page)
}

func IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/content/")
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
