package task_compute

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"backend/internal/xutil"
)

// openingParens lists opening brackets that may follow a model name in titles,
// so stripPersonPrefix can skip past them to reach the actual description.
const openingParens = "(\uFF08"
const closingParens = ")\uFF09"

// sitePrefixPatterns matches non-model-name prefixes that source websites
// inject before the protagonist name (e.g., category tags, numeric IDs,
// social media labels). These must be removed before the name itself can
// be stripped from the title for display.
var sitePrefixPatterns = regexp.MustCompile(`^\s*(?:` +
	`\[.*?\]` +
	`|\(.*?\)` +
	`|(?i)JK\s*Cosplay[：:]?` +
	`|(?i)cosplay美女` +
	`|(?i)cosplay` +
	`|动漫博主` +
	`|(?i)COS福利` +
	`|森萝财团[：:]` +
	`|No\.\d+` +
	`|(?i)Vol\.\d+` +
	`|(?i)TML\.\d+` +
	`|微博正?妹\s*像个?` +
	`|人气Coser` +
	`|长腿Coser` +
	`|(?i)COS萌妹` +
	`|萌系小姐姐` +
	`|萌妹` +
	`|小妖精` +
	`|二次元妹子` +
	`|尤物` +
	`|微博妹子` +
	`|(?i)Coser\s` +
	`|NinJA` +
	`|[图包套图写真]{2}` +
	`|(?i)(?:COS|coser)\b` +
	`|微博` +
	`|Cos小姐姐` +
	`|(?i)JK制服[：:]` +
	`)\s*`)

// dualPersonSepRE matches "&" variants that sites use to separate dual-model
// names, while the database stores them with the CJK conjunction character.
// Normalizing before prefix matching avoids HasPrefix mismatches.
var dualPersonSepRE = regexp.MustCompile(`\s*&\s*`)

// Display-progress bands: the `progress` column is phase-scoped (segments %
// while downloading, merge % while merging, transcode % while transcoding),
// so a raw phase value regresses to 0 at every phase boundary. The display
// progress composes the phase values into one monotonic 0-100 scale for UI:
// download dominates wall time (0-90), merge (90-95), transcode (95-99),
// probe (99), completed (100). Computed in ONE place (here) and applied to
// every read path (EnrichTaskMap, SSE forwarding, /api/videos) so the wire
// never carries a regressing percentage.
const (
	displayDownloadCap   = 90.0
	displayMergeBand     = 5.0
	displayTranscodeBand = 4.0
	displayProbeValue    = 99.0
)

func clampProgress(p float64) float64 {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// ComputeDisplayProgress maps a phase-scoped progress value to the monotonic
// composite display scale. Paused/failed/cancelled rows return the raw value:
// the column no longer records which phase it belongs to once the task leaves
// its active status, and guessing would be worse than showing the phase value.
// Non-video tasks are single-phase and pass through unchanged.
func ComputeDisplayProgress(taskType, status string, phaseProgress float64) float64 {
	if taskType != "video" {
		return phaseProgress
	}
	p := clampProgress(phaseProgress)
	switch status {
	case "scraping", "downloading":
		return p * displayDownloadCap / 100
	case "merging":
		return displayDownloadCap + p/100*displayMergeBand
	case "transcoding":
		return displayDownloadCap + displayMergeBand + p/100*displayTranscodeBand
	case "probing":
		return displayProbeValue
	case "completed":
		return 100
	default:
		return phaseProgress
	}
}

// RewriteProgressPayload returns a copy of a task:progress event payload with
// the display-progress rewrite applied: "progress" becomes the composite
// value and the raw phase percentage moves to "phaseProgress". Payloads
// without a numeric progress pass through untouched.
func RewriteProgressPayload(payload map[string]any) map[string]any {
	raw, ok := payload["progress"].(float64)
	if !ok {
		return payload
	}
	taskType, _ := payload["taskType"].(string)
	if taskType == "" {
		taskType = "video"
	}
	status, _ := payload["status"].(string)
	out := make(map[string]any, len(payload)+1)
	for k, v := range payload {
		out[k] = v
	}
	out["phaseProgress"] = raw
	out["progress"] = ComputeDisplayProgress(taskType, status, raw)
	return out
}

func ComputeEffectiveStatus(status, taskType string, imageCount, videoCount int) string {
	hasScrapeResults := imageCount > 0 || videoCount > 0
	switch status {
	case "paused":
		// Paused tasks show as "paused" regardless of scrape results.
		// This lets users see that they intentionally paused the task,
		// rather than it being stuck in "scraping" or "download_pending".
		return "paused"
	case "pending":
		// A pending task is waiting for a slot (queue-full hold-back from
		// the scheduler) or has not been started yet. It must NOT show as
		// "scraping": StatusReporter maps held-back nodes to "pending" so
		// the frontend can truthfully show them as waiting, keeping the
		// "only N tasks enter the scrape queue" design visible to users.
		if hasScrapeResults {
			return "download_pending"
		}
		return "pending"
	case "scraped":
		return "download_pending"
	default:
		return status
	}
}

func ComputeAllowedActions(status, taskType string) []string {
	actions := []string{}
	switch taskType {
	case "sniff":
		actions = append(actions, "delete")
	case "gallery":
		switch status {
		case "pending", "scrape_pending":
			actions = append(actions, "start", "pause", "delete")
		case "scraping", "downloading":
			actions = append(actions, "pause", "cancel", "delete")
		case "scraped", "download_pending":
			actions = append(actions, "start", "pause", "delete")
		case "paused":
			actions = append(actions, "start", "resume", "delete")
		case "failed", "partial":
			actions = append(actions, "retry", "delete")
		case "completed":
			actions = append(actions, "delete")
		case "cancelled":
			actions = append(actions, "retry", "delete")
		default:
			actions = append(actions, "delete")
		}
	default: // video
		switch status {
		case "pending":
			actions = append(actions, "start", "delete")
		case "scraping", "downloading":
			actions = append(actions, "pause", "cancel", "delete")
		case "paused":
			actions = append(actions, "resume", "cancel", "delete")
		case "failed", "cancelled":
			actions = append(actions, "retry", "delete")
		case "completed", "partial":
			actions = append(actions, "delete")
		case "scrape_pending", "download_pending":
			actions = append(actions, "pause", "delete")
		case "transcoding", "merging", "probing":
			actions = append(actions, "cancel", "delete")
		default:
			actions = append(actions, "delete")
		}
	}
	return actions
}

func ComputeProgressStage(status, taskType string, progress float64) string {
	if taskType == "sniff" {
		switch status {
		case "scraping":
			return "tasks.progressStageAnalyzing"
		case "completed":
			return "tasks.progressStageCompleted"
		case "failed":
			return "tasks.progressStageFailed"
		default:
			return "tasks.progressStagePending"
		}
	}
	switch status {
	case "pending":
		return "tasks.progressStagePending"
	case "scraping":
		return "tasks.progressStageScraping"
	case "scrape_pending":
		return "tasks.progressStageScrapePending"
	case "scraped", "download_pending":
		return "tasks.progressStageDownloadPending"
	case "completed":
		return "tasks.progressStageCompleted"
	case "failed":
		return "tasks.progressStageFailed"
	case "cancelled":
		return "tasks.progressStageCancelled"
	case "paused":
		return "tasks.progressStagePaused"
	default:
		// Post-processing phases (merging, transcoding, probing) are
		// identified by the status field rather than progress thresholds.
		// This decouples phase display from progress value mapping so
		// that download progress can use the full 0-100 range without
		// causing the stage label to flicker or regress.
		switch status {
		case "merging":
			return "tasks.progressStageMerging"
		case "transcoding":
			// "probing" is a real persisted status now; this progress>=100
			// check only remains as the read-time fallback for rows
			// written before it existed (live transcode events are clamped
			// below 100, so 100 marks the probe window).
			if progress >= 100 {
				return "tasks.progressStageProbing"
			}
			return "tasks.progressStageTranscoding"
		case "probing":
			return "tasks.progressStageProbing"
		}
		if taskType == "gallery" {
			return "tasks.progressStageDownloading"
		}
		return "tasks.progressStageDownloading"
	}
}

func StripPersonFromTitle(title, person string) string {
	if title == "" || person == "" {
		return title
	}

	if stripped := stripPersonPrefix(title, person); stripped != "" {
		return stripped
	}

	normTitle := normalizeDualPerson(title)
	normPerson := normalizeDualPerson(person)
	if normTitle != title || normPerson != person {
		if stripped := stripPersonPrefix(normTitle, normPerson); stripped != "" {
			return stripped
		}
	}

	cleaned := stripSitePrefixes(title)
	if cleaned != title {
		if stripped := stripPersonPrefix(cleaned, person); stripped != "" {
			return stripped
		}
		normCleaned := normalizeDualPerson(cleaned)
		if stripped := stripPersonPrefix(normCleaned, normPerson); stripped != "" {
			return stripped
		}
	}

	for _, name := range strings.Split(person, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if stripped := stripPersonPrefix(title, name); stripped != "" {
			return stripped
		}
		if stripped := stripPersonPrefix(cleaned, name); stripped != "" {
			return stripped
		}
	}

	return title
}

func stripPersonPrefix(title, name string) string {
	if !strings.HasPrefix(title, name) {
		return ""
	}
	after := title[len(name):]
	after = strings.TrimLeft(after, " \t")

	// Skip parenthetical suffixes that sites append after the name.
	if firstRune, size := utf8.DecodeRuneInString(after); size > 0 && strings.ContainsRune(openingParens, firstRune) {
		closingRune := matchingCloseParen(firstRune)
		if idx := strings.IndexRune(after, closingRune); idx >= 0 {
			after = after[idx+utf8.RuneLen(closingRune):]
			after = strings.TrimLeft(after, " \t")
		}
	}

	after = strings.TrimLeft(after, "-\u2013\u2014:_|　")
	after = strings.TrimSpace(after)
	if after == "" {
		return ""
	}
	return after
}

// matchingCloseParen returns the closing bracket for a given opening one,
// handling both ASCII and fullwidth CJK parentheses.
func matchingCloseParen(open rune) rune {
	switch open {
	case '\uFF08': // Fullwidth left parenthesis
		return '\uFF09' // Fullwidth right parenthesis
	default:
		return ')'
	}
}

func stripSitePrefixes(title string) string {
	return sitePrefixPatterns.ReplaceAllString(title, "")
}

func normalizeDualPerson(s string) string {
	return dualPersonSepRE.ReplaceAllString(s, "与")
}

// TaskIDKey returns a unique task identifier (used for throttling, aggregation).
// Format: "taskType:taskId", e.g. "gallery:123"
func TaskIDKey(m map[string]any) string {
	taskType, _ := m["TaskType"].(string)
	if taskType == "" {
		taskType, _ = m["taskType"].(string)
	}
	taskID := ""
	switch v := m["ID"].(type) {
	case int:
		taskID = strconv.Itoa(v)
	case int64:
		taskID = strconv.FormatInt(v, 10)
	case string:
		taskID = v
	case float64:
		taskID = strconv.FormatInt(int64(v), 10)
	}
	if taskID == "" {
		switch v := m["taskId"].(type) {
		case int:
			taskID = strconv.Itoa(v)
		case int64:
			taskID = strconv.FormatInt(v, 10)
		case string:
			taskID = v
		case float64:
			taskID = strconv.FormatInt(int64(v), 10)
		}
	}
	return taskType + ":" + taskID
}

// EnrichTaskMap adds computed fields to a task map before sending to the frontend.
func EnrichTaskMap(task map[string]any) map[string]any {
	status, _ := task["Status"].(string)
	if status == "scraped" {
		status = "download_pending"
		task["Status"] = status
	}
	taskType, _ := task["TaskType"].(string)
	imageCount, _ := task["ImageCount"].(int)
	videoCount, _ := task["VideoCount"].(int)
	// The stored progress is phase-scoped; keep it as PhaseProgress and
	// rewrite Progress to the monotonic composite scale. The stage label is
	// derived from the RAW value so the legacy transcoding>=100 probe-window
	// fallback keeps working for pre-existing rows.
	rawProgress, _ := task["Progress"].(float64)

	task["PhaseProgress"] = rawProgress
	task["EffectiveStatus"] = ComputeEffectiveStatus(status, taskType, imageCount, videoCount)
	task["ProgressStage"] = ComputeProgressStage(status, taskType, rawProgress)
	task["AllowedActions"] = ComputeAllowedActions(status, taskType)
	task["Progress"] = ComputeDisplayProgress(taskType, status, rawProgress)

	title, _ := task["GalleryTitle"].(string)
	person, _ := task["Person"].(string)
	if title != "" && person != "" {
		task["GalleryTitle"] = StripPersonFromTitle(title, person)
	}

	return task
}

// ParseTagsColumn decodes the video_infos.tags column into a tag slice.
//
// The column holds a JSON array string in most rows, but older rows may
// carry a comma / ideographic-comma / space separated plain string, so JSON
// decoding is attempted first with the whole value passed to CleanTagList as
// the fallback.
func ParseTagsColumn(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" || trimmed == "[]" {
		return nil
	}
	var values []string
	if err := json.Unmarshal([]byte(trimmed), &values); err == nil {
		return xutil.CleanTagList(values)
	}
	return xutil.CleanTagList([]string{trimmed})
}
