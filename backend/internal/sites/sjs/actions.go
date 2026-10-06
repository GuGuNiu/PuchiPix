package sjs

import (
	"regexp"
	"strings"
)

// ExtractDownloadLinks returns the cloud storage links of a thread, or nothing
// when the thread is purchase-gated.
func ExtractDownloadLinks(html string) []string {
	linksDiv := extractClassContent(html, "jnpar-pansell-links")
	if linksDiv == "" {
		return nil
	}

	if strings.Contains(linksDiv, "购买后可看") {
		return nil
	}

	return parseDownloadLinks(linksDiv)
}

func IsThreadPurchasable(html string) bool {
	linksDiv := extractClassContent(html, "jnpar-pansell-links")
	if linksDiv == "" {
		return false
	}
	return strings.Contains(linksDiv, "购买后可看")
}

func parseDownloadLinks(linksHTML string) []string {
	var links []string
	seen := make(map[string]bool)

	textPattern := regexp.MustCompile(`<span[^>]*class=["'][^"']*jnpar-link-text[^"']*["'][^>]*>([\s\S]*?)</span>`)
	for _, m := range textPattern.FindAllStringSubmatch(linksHTML, -1) {
		if len(m) >= 2 {
			text := stripTags(m[1])
			text = strings.TrimSpace(text)
			if text != "" && !seen[text] {
				seen[text] = true
				links = append(links, text)
			}
		}
	}

	hrefPattern := regexp.MustCompile(`<a[^>]*href=["']([^"']*)["'][^>]*>`)
	for _, m := range hrefPattern.FindAllStringSubmatch(linksHTML, -1) {
		if len(m) >= 2 {
			href := m[1]
			if href != "" && isCloudStorageURL(href) && !seen[href] {
				seen[href] = true
				links = append(links, href)
			}
		}
	}

	return links
}

func isCloudStorageURL(href string) bool {
	domains := []string{"pan.", "quark", "baidu", "aliyun", "115.com", "lanzou"}
	for _, d := range domains {
		if strings.Contains(href, d) {
			return true
		}
	}
	return false
}

func stripTags(html string) string {
	return regexp.MustCompile(`<[^>]+>`).ReplaceAllString(html, " ")
}
