package sjs

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"backend/internal/infra"
	"backend/internal/sites"
	"backend/internal/stealth"
)

var actionsLogger = infra.NewLogger("SjsProvider")

// CheckinResult holds the outcome of a daily check-in operation.
type CheckinResult struct {
	Success          bool
	AlreadyCheckedIn bool
	Message          string
	Rank             string
	Level            string
	ContinuousDays   string
	TotalDays        string
	Reward           string
	TotalPoints      string
	TodayCount       string
}

// BuyResult holds the outcome of a thread purchase operation.
type BuyResult struct {
	Success       bool
	AlreadyBought bool
	Message       string
	Subject       string
	DownloadLinks []string
}

// ExtractDownloadLinks parses the jnpar-pansell-links div for cloud
// storage download URLs, returning empty when content requires purchase.
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

// IsThreadPurchasable checks whether the thread requires payment to
// access download links.
func IsThreadPurchasable(html string) bool {
	linksDiv := extractClassContent(html, "jnpar-pansell-links")
	if linksDiv == "" {
		return false
	}
	return strings.Contains(linksDiv, "购买后可看")
}

// PerformCheckin executes the daily check-in flow for an SJS account,
// navigating the k_misign plugin pages and following the sign link.
func PerformCheckin(ctx context.Context, am *sites.SiteAccountManager, accountID int) (*CheckinResult, error) {
	if am == nil {
		return &CheckinResult{Success: false, Message: "no account manager"}, nil
	}

	cookies, err := am.GetAuthCookies(ctx, accountID)
	if err != nil || len(cookies) == 0 {
		return &CheckinResult{Success: false, Message: "no valid credentials"}, nil
	}

	jar := NewCookieJar()
	jar.LoadFromCookieData(cookies)

	tracker := stealth.GetDomainHealthTracker()
	domain := tracker.GetBestDomain(SiteDomains)
	signPageURL := domain + "/k_misign-sign.html"

	signResp, err := httpRequest(ctx, "GET", signPageURL, jar, domain+"/", nil)
	if err != nil {
		return &CheckinResult{Success: false, Message: "fetch sign page failed: " + err.Error()}, nil
	}
	jar.ParseSetCookie(signResp.SetCookies)

	signHref := extractAnchorHref(signResp.Body, "JD_sign")

	if signHref == "" ||
		strings.Contains(signResp.Body, "您今天已经签到") ||
		strings.Contains(signResp.Body, "今日已签到") ||
		strings.Contains(signResp.Body, "已签到") {

		if strings.Contains(signResp.Body, "您今天已经签到") ||
			strings.Contains(signResp.Body, "今日已签到") ||
			strings.Contains(signResp.Body, "已签到") {
			return parseCheckinResult(signResp.Body, true), nil
		}
		return &CheckinResult{Success: false, Message: "sign link not found, check login status"}, nil
	}

	checkInURL := signHref
	if !strings.HasPrefix(checkInURL, "http") {
		if strings.HasPrefix(checkInURL, "/") {
			checkInURL = domain + checkInURL
		} else {
			checkInURL = domain + "/" + checkInURL
		}
	}

	checkInResp, err := httpRequest(ctx, "GET", checkInURL, jar, signPageURL, nil)
	if err != nil {
		return &CheckinResult{Success: false, Message: "check-in request failed: " + err.Error()}, nil
	}
	jar.ParseSetCookie(checkInResp.SetCookies)

	if strings.Contains(checkInResp.Body, "签到成功") ||
		strings.Contains(checkInResp.Body, "您今天已经签到") ||
		strings.Contains(checkInResp.Body, "今日已签到") ||
		strings.Contains(checkInResp.Body, "已签到") {

		afterResp, err := httpRequest(ctx, "GET", signPageURL, jar, domain+"/", nil)
		if err == nil {
			tracker.MarkHealthy(domain)
			return parseCheckinResult(afterResp.Body, true), nil
		}
		return parseCheckinResult(checkInResp.Body, true), nil
	}

	if strings.Contains(checkInResp.Body, "CDATA") {
		afterResp, err := httpRequest(ctx, "GET", signPageURL, jar, domain+"/", nil)
		if err == nil {
			if strings.Contains(afterResp.Body, "签到成功") ||
				strings.Contains(afterResp.Body, "您今天已经签到") ||
				strings.Contains(afterResp.Body, "今日已签到") {
				tracker.MarkHealthy(domain)
				return parseCheckinResult(afterResp.Body, true), nil
			}
		}
	}

	tracker.MarkRateLimited(domain)
	return &CheckinResult{Success: false, Message: "check-in failed"}, nil
}

// BuyThread purchases a paid thread via the jnpar_pansell plugin,
// extracting download links after a successful purchase.
func BuyThread(ctx context.Context, am *sites.SiteAccountManager, accountID int, tid string) (*BuyResult, error) {
	if am == nil {
		return &BuyResult{Success: false, Message: "no account manager"}, nil
	}

	cookies, err := am.GetAuthCookies(ctx, accountID)
	if err != nil || len(cookies) == 0 {
		return &BuyResult{Success: false, Message: "no valid credentials"}, nil
	}

	jar := NewCookieJar()
	jar.LoadFromCookieData(cookies)

	tracker := stealth.GetDomainHealthTracker()
	domain := tracker.GetBestDomain(SiteDomains)
	threadURL := domain + "/thread-" + tid + "-1-1.html"

	threadResp, err := httpRequest(ctx, "GET", threadURL, jar, domain+"/", nil)
	if err != nil {
		return &BuyResult{Success: false, Message: "fetch thread failed: " + err.Error()}, nil
	}

	subject := extractElementText(threadResp.Body, "span[id='thread_subject']")
	if subject == "" {
		subject = "Unknown"
	}

	linksDiv := extractClassContent(threadResp.Body, "jnpar-pansell-links")
	if linksDiv != "" {
		if !strings.Contains(linksDiv, "购买后可看") && !strings.Contains(linksDiv, "立即购买") {
			downloadLinks := parseDownloadLinks(linksDiv)
			return &BuyResult{
				Success:       true,
				AlreadyBought: true,
				Message:       "already purchased",
				Subject:       subject,
				DownloadLinks: downloadLinks,
			}, nil
		}
	} else {
		return &BuyResult{
			Success:       true,
			AlreadyBought: true,
			Message:       "no purchase required or already purchased",
			Subject:       subject,
		}, nil
	}

	buyPageURL := fmt.Sprintf("%s/jnpar_pansell-pay.html?tid=%s&pid=&infloat=yes&handlekey=jnpar_pay_win1&inajax=1&ajaxtarget=fwin_content_jnpar_pay_win1",
		domain, tid)

	buyPageResp, err := httpRequest(ctx, "GET", buyPageURL, jar, threadURL, nil)
	if err != nil {
		return &BuyResult{Success: false, Message: "fetch buy page failed: " + err.Error()}, nil
	}

	cdataMatch := regexp.MustCompile(`<!--\[CDATA\[([\s\S]*?)\]\]&gt;`).FindStringSubmatch(buyPageResp.Body)
	if len(cdataMatch) < 2 {
		return &BuyResult{Success: false, AlreadyBought: false, Message: "CDATA not found", Subject: subject}, nil
	}

	formData := cdataMatch[1]
	buyFormhash := extractInputValue(formData, "formhash")
	handlekey := extractInputValue(formData, "handlekey")
	buyTid := extractInputValue(formData, "tid")
	pid := extractInputValue(formData, "pid")

	if buyTid == "" {
		buyTid = tid
	}

	buyURL := domain + "/plugin.php?id=jnpar_pansell:pay"
	buyBody := url.Values{
		"formhash":  {buyFormhash},
		"handlekey": {handlekey},
		"tid":       {buyTid},
		"pid":       {pid},
		"submit":    {"true"},
	}
	if buyBody.Get("handlekey") == "" {
		buyBody.Set("handlekey", "jnpar_pay_win1")
	}

	buyResp, err := httpRequest(ctx, "POST", buyURL, jar, threadURL, buyBody)
	if err != nil {
		return &BuyResult{Success: false, Message: "buy request failed: " + err.Error()}, nil
	}

	if strings.Contains(buyResp.FinalURL, "thread-"+tid) {
		linksDivAfter := extractClassContent(buyResp.Body, "jnpar-pansell-links")
		var downloadLinks []string
		if linksDivAfter != "" {
			downloadLinks = parseDownloadLinks(linksDivAfter)
		}
		return &BuyResult{
			Success:       true,
			AlreadyBought: false,
			Message:       "purchase successful",
			Subject:       subject,
			DownloadLinks: downloadLinks,
		}, nil
	}

	return &BuyResult{
		Success:       false,
		AlreadyBought: false,
		Message:       "purchase failed, insufficient balance or already purchased",
		Subject:       subject,
	}, nil
}

// CheckinAllAccounts performs daily check-in for all active SJS accounts.
func CheckinAllAccounts(ctx context.Context, am *sites.SiteAccountManager) []struct {
	AccountID int
	Username  string
	Result    *CheckinResult
} {
	if am == nil {
		return nil
	}

	accounts, err := am.GetAccountsBySiteId(ctx, "sjs")
	if err != nil {
		return nil
	}

	var results []struct {
		AccountID int
		Username  string
		Result    *CheckinResult
	}

	for _, acc := range accounts {
		if acc.Status != sites.AccountStatusActive {
			continue
		}

		result, _ := PerformCheckin(ctx, am, acc.ID)
		_ = am.MarkUsed(ctx, acc.ID)

		results = append(results, struct {
			AccountID int
			Username  string
			Result    *CheckinResult
		}{
			AccountID: acc.ID,
			Username:  acc.Username,
			Result:    result,
		})

		if len(results) < len(accounts) {
			stealth.Sleep(2000, 5000)
		}
	}

	return results
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

func parseCheckinResult(html string, alreadyCheckedIn bool) *CheckinResult {
	result := &CheckinResult{
		Success:          true,
		AlreadyCheckedIn: alreadyCheckedIn,
	}

	if alreadyCheckedIn {
		result.Message = "already checked in today"
	} else {
		result.Message = "check-in successful"
	}

	result.Rank = extractInputValue(html, "qiandaobtnnum")
	result.Level = extractInputValue(html, "lxlevel")
	if result.Level != "" {
		result.Level = "Lv." + result.Level
	}
	result.ContinuousDays = extractInputValue(html, "lxdays")
	result.TotalDays = extractInputValue(html, "lxtdays")
	result.Reward = extractInputValue(html, "lxreward")

	if m := regexp.MustCompile(`(\d+)\s*金币`).FindStringSubmatch(html); len(m) >= 2 {
		result.TotalPoints = m[1]
	}

	if m := regexp.MustCompile(`今日签到人数[\s\S]*?(\d+)[\s\S]*?人`).FindStringSubmatch(html); len(m) >= 2 {
		result.TodayCount = m[1]
	}

	return result
}
