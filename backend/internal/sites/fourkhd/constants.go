package fourkhd

import (
	"fmt"
	"regexp"
	"strings"
)

// GalleryPageMetadata holds parsed data from a single 4KHD gallery page.
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

// GalleryImageEntry represents a single image URL with its page index.
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
	// URL patterns
	// Detail page: /content/{category}/{slug}.html
	// Pagination:  /content/{category}/{slug}.html/{page}
	contentIDPattern = regexp.MustCompile(`/content/(\d+)/([^/]+)\.html`)
	pageNumPattern   = regexp.MustCompile(`\.html/(\d+)(?:/|$)`)

	// Title pattern: "主角 描述[大小-数量photos]"
	titleSizePattern = regexp.MustCompile(`\[(\d+(?:\.\d+)?(?:MB|GB))-(\d+)photos\]`)

	// Image URL pattern — matches URLs containing 4khd.com in the path
	imageURLPattern = regexp.MustCompile(`https?://[^\s"'<>]*4khd\.com[^\s"'<>]*\.(?:webp|jpg|png|jpeg)[^\s"'<>]*`)

	// Pagination
	pageLinkPattern = regexp.MustCompile(`href="([^"]*\.html/(\d+))"`)

	// Download link
	downloadLinkPattern = regexp.MustCompile(`href="(https://m\.4khd\.com/[^"]+)"`)

	// Extract password: "Extracting passwords: </p><p>4KHD</p>"
	passwordPattern = regexp.MustCompile(`Extracting passwords:\s*</p>\s*<p[^>]*>(.+?)</p>`)

	// Publish time
	publishTimePattern = regexp.MustCompile(`<meta property="article:published_time" content="([^"]+)"`)

	// Canonical URL
	canonicalPattern = regexp.MustCompile(`<link rel="canonical" href="([^"]+)"`)

	// Author
	authorPattern = regexp.MustCompile(`<meta name="author" content="([^"]+)"`)

	// Related galleries
	relatedPattern = regexp.MustCompile(`<a href="(https://www\.4khd\.com/content/[^"]+)"><img[^>]*src="([^"]*)"[^>]*><p>(.+?)</p></a>`)
)

// ExtractContentID extracts the category ID and slug from a 4KHD URL.
// Example: /content/02/island-fish-prince-eugen-bunny-girl.html → "02", "island-fish-prince-eugen-bunny-girl"
func ExtractContentID(rawURL string) (category, slug string) {
	m := contentIDPattern.FindStringSubmatch(rawURL)
	if len(m) >= 3 {
		return m[1], m[2]
	}
	return "", ""
}

// ExtractPageNum extracts the page number from a paginated URL.
// Returns 0 if not a paginated URL.
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

// BuildPageURL constructs a paginated URL from a base URL and page number.
// Example: BuildPageURL("https://qbep.uuss.uk/content/02/slug.html", 2)
// → "https://qbep.uuss.uk/content/02/slug.html/2"
func BuildPageURL(baseURL string, page int) string {
	return baseURL + "/" + itoa(page)
}

// IsListingPage checks if the URL is a listing page (not a single gallery).
func IsListingPage(rawURL string) bool {
	return !strings.Contains(rawURL, "/content/")
}

// itoa converts int to string.
func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
