package sjs

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

var videoURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*`)

// SearchEntry represents a single result from a search or forum listing page.
type SearchEntry struct {
	URL      string
	Title    string
	CoverURL string
	Date     string
}

// ExtendedMetadata holds the full metadata extracted from a thread page.
type ExtendedMetadata struct {
	Title      string
	Tags       []string
	Actors     []string
	Categories []string
	Director   string
	Blocked    bool
}

// PostContentData holds images, videos, and metadata extracted from a
// single thread page's first post content.
type PostContentData struct {
	Images      []PostImage
	Videos      []string
	CoverURL    string
	PublishTime string
}

// PostImage represents a single image URL with its page index.
type PostImage struct {
	URL       string
	PageIndex int
}

// ExtractSearchResults parses search result items from li.nexwateritems
// elements, extracting thread URLs, titles, and dates.
func ExtractSearchResults(doc *goquery.Document) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	doc.Find("li.nexwateritems").Each(func(_ int, item *goquery.Selection) {
		link := item.Find(`a[href*="mod=viewthread&tid="]`).First()
		if link.Length() == 0 {
			return
		}

		href, exists := link.Attr("href")
		if !exists {
			return
		}

		tid := ExtractThreadID(href)
		if tid == "" {
			return
		}
		if seen[tid] {
			return
		}
		seen[tid] = true

		title := strings.TrimSpace(link.Text())
		if title == "" {
			h3 := item.Find("h3 a, h3").First()
			title = strings.TrimSpace(h3.Text())
		}

		var date string
		allText := item.Text()
		if m := relDatePattern.FindString(allText); m != "" {
			date = m
		}

		results = append(results, SearchEntry{
			URL:   ResolveURL("/thread-" + tid + "-1-1.html"),
			Title: title,
			Date:  date,
		})
	})

	if len(results) > 30 {
		results = results[:30]
	}
	return results
}

// ExtractForumListResults parses thread entries from #threadlisttableid,
// extracting both normal and sticky threads.
func ExtractForumListResults(doc *goquery.Document) []SearchEntry {
	var results []SearchEntry
	seen := make(map[string]bool)

	doc.Find(`#threadlisttableid > div[id^="normalthread_"], #threadlisttableid > div[id^="stickthread_"]`).Each(func(_ int, container *goquery.Selection) {
		titleLink := container.Find("a.s.xst").First()
		if titleLink.Length() == 0 {
			return
		}

		href, exists := titleLink.Attr("href")
		if !exists || href == "" || seen[href] {
			return
		}
		seen[href] = true

		title := strings.TrimSpace(titleLink.Text())

		var date string
		containerText := container.Text()
		if m := datePattern.FindString(containerText); m != "" {
			date = m
		}

		results = append(results, SearchEntry{
			URL:   href,
			Title: title,
			Date:  date,
		})
	})

	if len(results) > 50 {
		results = results[:50]
	}
	return results
}

// ExtractExtendedMetadata parses title, author, date, category, and tags
// from a thread detail page document.
func ExtractExtendedMetadata(doc *goquery.Document) ExtendedMetadata {
	var raw struct {
		Title          string
		Author         string
		Date           string
		Category       string
		Tags           []string
		KeywordStr     string
		CoverURL       string
		DocumentTitle  string
	}

	raw.Title = strings.TrimSpace(doc.Find("#thread_subject").First().Text())
	raw.DocumentTitle = strings.TrimSpace(doc.Find("title").First().Text())

	firstPost := doc.Find(`#postlist div[id^="post_"]`).First()
	raw.Author = strings.TrimSpace(firstPost.Find(".authi a, .pi .authi a").First().Text())

	dateText := strings.TrimSpace(firstPost.Find(".authi em, .pti .authi em").First().Text())
	if m := datePattern.FindString(dateText); m != "" {
		raw.Date = m
	} else if m := publishedPattern.FindStringSubmatch(dateText); len(m) >= 2 {
		raw.Date = strings.TrimSpace(m[1])
	}

	breadcrumbLinks := doc.Find(".z a, #ct .z a")
	if breadcrumbLinks.Length() >= 2 {
		raw.Category = strings.TrimSpace(breadcrumbLinks.Last().Text())
	}

	doc.Find(".ptg a, .ptg mbk a").Each(func(_ int, a *goquery.Selection) {
		text := strings.TrimSpace(a.Text())
		if text != "" && len(text) < 30 {
			raw.Tags = append(raw.Tags, text)
		}
	})

	raw.KeywordStr = doc.Find(`meta[name="keywords"]`).AttrOr("content", "")

	contentEl := firstPost.Find(".t_f").First()
	if contentEl.Length() > 0 {
		contentEl.Find("img").Each(func(_ int, img *goquery.Selection) {
			if raw.CoverURL != "" {
				return
			}
			file := img.AttrOr("file", "")
			src := img.AttrOr("src", "")
			imgURL := file
			if imgURL == "" {
				imgURL = src
			}
			if imgURL != "" && !strings.Contains(imgURL, PlaceholderGIF) && !strings.HasPrefix(imgURL, "data:") {
				raw.CoverURL = imgURL
			}
		})
	}

	title := CleanSjsTitle(raw.Title)
	if title == "" {
		title = CleanSjsTitle(raw.DocumentTitle)
	}

	var metaKeywords []string
	for _, kw := range regexp.MustCompile(`[,;]`).Split(raw.KeywordStr, -1) {
		kw = strings.TrimSpace(kw)
		if kw != "" && len(kw) < 50 && !containsStr(raw.Tags, kw) {
			metaKeywords = append(metaKeywords, kw)
		}
	}

	allTags := append([]string{}, raw.Tags...)
	allTags = append(allTags, metaKeywords...)

	var actors []string
	if raw.Author != "" {
		actors = []string{raw.Author}
	}

	var categories []string
	if raw.Category != "" {
		categories = []string{raw.Category}
	}

	return ExtendedMetadata{
		Title:      title,
		Tags:       allTags,
		Actors:     actors,
		Categories: categories,
		Director:   raw.Author,
		Blocked:    false,
	}
}

// ExtractPostContent parses images, videos, cover URL, and publish time
// from the first post's .t_f content element.
func ExtractPostContent(doc *goquery.Document, pageIndex int) PostContentData {
	var result PostContentData

	firstPost := doc.Find(`#postlist div[id^="post_"]`).First()
	if firstPost.Length() == 0 {
		return result
	}

	contentEl := firstPost.Find(".t_f").First()
	if contentEl.Length() == 0 {
		return result
	}

	contentEl.Find("img").Each(func(_ int, img *goquery.Selection) {
		file := img.AttrOr("file", "")
		src := img.AttrOr("src", "")

		imgURL := file
		if imgURL == "" || strings.Contains(imgURL, PlaceholderGIF) {
			imgURL = src
		}

		if imgURL != "" &&
			!strings.Contains(imgURL, PlaceholderGIF) &&
			!strings.HasPrefix(imgURL, "data:") &&
			!strings.Contains(imgURL, "/static/image/common/") {
			result.Images = append(result.Images, PostImage{
				URL:       imgURL,
				PageIndex: pageIndex,
			})
			if result.CoverURL == "" {
				result.CoverURL = imgURL
			}
		}
	})

	contentEl.Find("video source, video, embed, iframe").Each(func(_ int, el *goquery.Selection) {
		src := el.AttrOr("src", "")
		if src == "" {
			src = el.AttrOr("data-src", "")
		}
		if src != "" && (strings.Contains(src, ".mp4") || strings.Contains(src, ".m3u8") || strings.Contains(src, ".flv")) {
			result.Videos = append(result.Videos, src)
		}
	})

	contentEl.Find("a").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if exists && href != "" && (strings.Contains(href, ".mp4") || strings.Contains(href, ".m3u8")) {
			result.Videos = append(result.Videos, href)
		}
	})

	contentElHTML, _ := contentEl.Html()
	videoMatches := videoURLPattern.FindAllString(contentElHTML, -1)
	for _, v := range videoMatches {
		if !containsStr(result.Videos, v) {
			result.Videos = append(result.Videos, v)
		}
	}

	dateText := strings.TrimSpace(firstPost.Find(".authi em, .pti .authi em").First().Text())
	if m := datePattern.FindString(dateText); m != "" {
		result.PublishTime = m
	}

	return result
}

// GetThreadTotalPages extracts the maximum page number from pagination
// controls, checking page links, last span, and page input title.
func GetThreadTotalPages(doc *goquery.Document) int {
	maxPage := 1

	doc.Find(".pg a, .pgs a").Each(func(_ int, a *goquery.Selection) {
		text := strings.TrimSpace(a.Text())
		if n, err := strconv.Atoi(text); err == nil && n > maxPage {
			maxPage = n
		}
	})

	lastSpan := doc.Find(".pg .last span, .pgs .last span").First()
	if lastSpan.Length() > 0 {
		text := strings.TrimSpace(lastSpan.Text())
		if n, err := strconv.Atoi(text); err == nil && n > maxPage {
			maxPage = n
		}
	}

	pageInput := doc.Find(".pg label input, .pgs label input").First()
	if pageInput.Length() > 0 {
		title := pageInput.AttrOr("title", "")
		if m := regexp.MustCompile(`(\d+)`).FindString(title); m != "" {
			if n, err := strconv.Atoi(m); err == nil && n > maxPage {
				maxPage = n
			}
		}
	}

	return maxPage
}

// GetNextPageUrl finds the URL for the next page in a listing, checking
// for next-page link texts and falling back to page number links.
func GetNextPageUrl(doc *goquery.Document, currentURL string, currentPage int) string {
	nextTexts := map[string]bool{
		"下一页": true, "Next": true, "下页": true, "»": true,
	}

	var nextLink string
	doc.Find(".pg a, .pgs a").Each(func(_ int, a *goquery.Selection) {
		if nextLink != "" {
			return
		}
		text := strings.TrimSpace(a.Text())
		if nextTexts[text] {
			href, exists := a.Attr("href")
			if exists && href != "" {
				nextLink = href
			}
		}
	})

	if nextLink != "" {
		return nextLink
	}

	nextNum := strconv.Itoa(currentPage + 1)
	doc.Find(".pg a, .pgs a").Each(func(_ int, a *goquery.Selection) {
		if nextLink != "" {
			return
		}
		text := strings.TrimSpace(a.Text())
		if text == nextNum {
			href, exists := a.Attr("href")
			if exists && href != "" {
				nextLink = href
			}
		}
	})

	if nextLink != "" {
		return nextLink
	}

	isSearchPage := strings.Contains(currentURL, "search.php") || strings.Contains(currentURL, "searchid=")
	if !isSearchPage {
		fid := ExtractForumID(currentURL)
		if fid != "" {
			return PrimaryDomain + "/forum-" + fid + "-" + strconv.Itoa(currentPage+1) + ".html"
		}
	}

	return ""
}

func containsStr(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
