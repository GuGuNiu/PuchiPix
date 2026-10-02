// Tests in this file run the extraction pipeline against captured production
// pages rather than trimmed fixtures, so a change in the site's markup shows
// up as a failure instead of silently emptying a metadata field.
//
// Captures live outside the repository (test/ is gitignored) and every test
// here skips when the capture is absent. Refresh them with the probe scripts
// under test/xvideos/scripts, then run:
// go test -run TestReal ./internal/sites/xvideos/
package xvideos

import (
	"os"
	"testing"
)

func TestRealPageFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/xvideos/data/detail.html")
	if err != nil {
		t.Skip("no capture")
	}
	html := string(raw)
	t.Logf("fixture size: %d bytes", len(html))

	result := &VideoDetailResult{}
	if m := HLSURLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.M3U8URL = m[1]
	}
	if m := MP4URLPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.MP4URL = m[1]
	}
	if m := UploaderPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.Uploader = m[1]
	}
	if m := EncodedIDScriptPattern.FindStringSubmatch(html); len(m) >= 2 {
		result.EncodedID = m[1]
	}
	if m := VideoUUIDPattern.FindStringSubmatch(result.M3U8URL); len(m) >= 2 {
		result.VideoUUID = m[1]
	}
	result.Title = extractTitle(html, "")
	result.ThumbnailURL = extractThumbnail(html)
	extractMetadataFromJSONLD(html, result)
	extractPlayerMetadata(html, result)

	t.Logf("m3u8       = %s", result.M3U8URL)
	t.Logf("mp4        = %s", result.MP4URL)
	t.Logf("uuid       = %s", result.VideoUUID)
	t.Logf("encodedId  = %s", result.EncodedID)
	t.Logf("title      = %s", result.Title)
	t.Logf("uploader   = %s", result.Uploader)
	t.Logf("duration   = %s (%ds)", result.Duration, result.DurationSec)
	t.Logf("views      = %d (%s)", result.Views, result.ViewsText)
	t.Logf("published  = %s", result.PublishDate)
	t.Logf("thumb      = %s", result.ThumbnailURL)
	t.Logf("categories (%d) = %v", len(result.Categories), result.Categories)
	t.Logf("tags       (%d) = %v", len(result.Tags), result.Tags)
	t.Logf("pornstars  (%d) = %v", len(result.Pornstars), result.Pornstars)

	if result.M3U8URL == "" {
		t.Error("no M3U8 URL extracted from the real page")
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
	if result.Views == 0 {
		t.Error("no view count extracted from the real page")
	}
	if len(result.Categories) == 0 {
		t.Error("no categories extracted from the real page")
	}
	if len(result.Tags) == 0 {
		t.Error("no tags extracted from the real page")
	}
	if len(result.Pornstars) == 0 {
		t.Error("no pornstars extracted from the real page")
	}

	out := result.ToScrapeResult("https://www.xvideos.com/video.omdieok464f/slug")
	t.Logf("ScrapeResult.Categories = %v", out.Categories)
	t.Logf("ScrapeResult.Actors     = %v", out.Actors)
	t.Logf("ScrapeResult.Tags[:5]   = %v", out.Tags[:min(5, len(out.Tags))])
}

func TestRealListingFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/xvideos/data/home.html")
	if err != nil {
		t.Skip("no capture")
	}

	html := string(raw)
	t.Logf("fixture size: %d bytes", len(html))

	result, err := ScrapeListingFromHTML(html, "https://www.xvideos.com/")
	if err != nil {
		t.Fatalf("listing parse failed: %v", err)
	}

	t.Logf("videos found: %d (page %d of %d, hasNext=%v, next=%s)",
		len(result.Videos), result.CurrentPage, result.TotalPages, result.HasNextPage, result.NextPageURL)
	for i, v := range result.Videos {
		if i >= 5 {
			break
		}
		t.Logf("  - %s | %s | %s | %ds | %s | vid=%s cdn=%s",
			v.EncodedID, v.Title, v.Duration, v.DurationSec, v.PageURL, v.VideoID, v.CDNID)
	}

	if len(result.Videos) == 0 {
		t.Fatal("no videos extracted from the real listing page")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
