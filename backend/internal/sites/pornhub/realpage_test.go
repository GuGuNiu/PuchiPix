// Tests in this file run the extraction pipeline against a full production
// detail page and listing page rather than a trimmed fixture. They are the
// regression net for the selectors: the class names the site uses change far
// more often than the data-label attributes the code depends on, and a
// trimmed fixture cannot show that.
//
// Captures are kept outside the repository (test/ is gitignored) and every
// test here skips when the capture is absent, so the suite stays green on a
// clean checkout. Refresh a capture with the probe scripts under
// test/pornhub/scripts, then run: go test -run TestReal ./internal/sites/pornhub/
package pornhub

import (
	"os"
	"testing"
)

// TestRealPageFixture runs the detail-page pipeline against a captured page.
func TestRealPageFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/pornhub/data/detail.html")
	if err != nil {
		t.Skip("no captured page available")
	}
	html := string(raw)
	t.Logf("fixture size: %d bytes", len(html))

	if IsAntiBotPage(html) {
		t.Fatal("real page was classified as an anti-bot interstitial")
	}

	result := &VideoDetailResult{}
	extractMediaURLs(html, result)
	extractMetadataFromJSONLD(html, result)
	extractModelProfile(html, result)
	extractUploader(html, result)

	t.Logf("m3u8       = %s", result.M3U8URL)
	t.Logf("candidates = %d", len(result.M3U8Candidates))
	for _, c := range result.M3U8Candidates {
		t.Logf("  - %s %s", c.Title, c.URL)
	}
	t.Logf("getMedia   = %s", result.GetMediaURL)
	t.Logf("title      = %s", result.Title)
	t.Logf("uploader   = %s", result.Uploader)
	t.Logf("duration   = %s (%ds)", result.Duration, result.DurationSec)
	t.Logf("views      = %d", result.Views)
	t.Logf("published  = %s", result.PublishDate)
	t.Logf("thumb      = %s", result.ThumbnailURL)

	result.Tags = extractTags(html)
	result.Categories = extractCategories(html)
	result.Cast = extractCast(html)

	t.Logf("tags       (%d) = %v", len(result.Tags), result.Tags)
	t.Logf("categories (%d) = %v", len(result.Categories), result.Categories)
	t.Logf("cast       (%d) = %v", len(result.Cast), result.Cast)

	if result.M3U8URL == "" {
		t.Fatal("no M3U8 URL extracted from the real page")
	}
	if result.Title == "" {
		t.Error("no title extracted from the real page")
	}
	if result.DurationSec == 0 {
		t.Error("no duration extracted from the real page")
	}
	if result.PublishDate == "" {
		t.Error("no publish date extracted from the real page")
	}
	if len(result.Tags) == 0 {
		t.Error("no tags extracted from the real page")
	}
	if len(result.Categories) == 0 {
		t.Error("no categories extracted from the real page")
	}
	if result.ThumbnailURL == "" {
		t.Error("no thumbnail extracted from the real page")
	}

	out := result.ToScrapeResult("https://www.pornhub.com/view_video.php?viewkey=6a8c673a68504")
	t.Logf("ScrapeResult.Tags       = %v", out.Tags)
	t.Logf("ScrapeResult.Categories = %v", out.Categories)
	t.Logf("ScrapeResult.Actors     = %v", out.Actors)
}

func TestRealListingFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/pornhub/data/listing.html")
	if err != nil {
		t.Skip("no captured listing available")
	}

	result, err := ScrapeListingFromHTML(string(raw), "https://www.pornhub.com/video")
	if err != nil {
		t.Fatalf("listing parse failed: %v", err)
	}

	t.Logf("videos found: %d (page %d of %d, hasNext=%v)",
		len(result.Videos), result.CurrentPage, result.TotalPages, result.HasNextPage)
	for i, v := range result.Videos {
		if i >= 5 {
			break
		}
		t.Logf("  - %s | %s | %s | %ds | %s",
			v.ViewKey, v.Title, v.Duration, v.DurationSec, v.PageURL)
	}

	if len(result.Videos) == 0 {
		t.Fatal("no videos extracted from the real listing page")
	}
}
