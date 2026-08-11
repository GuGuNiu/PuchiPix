package api

import "strings"

// taskCompute provides backend-side computation of task metadata that was
// previously implemented in the frontend (task-helpers.ts and use-task-actions.ts).
// Migrating these rules to the backend eliminates the "frontend overprivilege"
// anti-pattern where business logic was duplicated and potentially inconsistent.

// computeEffectiveStatus determines the display status used for filtering.
// Previously frontend logic in getEffectiveFilterStatus:
//   - paused + has scrape results → download_pending
//   - paused + no scrape results → scraping
//   - pending + has scrape results → download_pending
//   - pending + no scrape results → scraping
//   - otherwise → raw Status
func computeEffectiveStatus(status, taskType string, imageCount, videoCount int) string {
	hasScrapeResults := imageCount > 0 || videoCount > 0
	switch status {
	case "paused":
		if hasScrapeResults {
			return "download_pending"
		}
		return "scraping"
	case "pending":
		if hasScrapeResults {
			return "download_pending"
		}
		return "scraping"
	case "scraped":
		// DB-internal status: gallery scrape complete, download not yet
		// started. Map to the frontend-visible "download_pending" so the
		// task list shows the correct badge (was leaking as raw "scraped"
		// which is not a valid TaskStatus in the frontend type system).
		return "download_pending"
	default:
		return status
	}
}

// computeAllowedActions returns the list of actions the user can perform on
// a task, based on its type and current status. Previously scattered across
// task-table-row.tsx (canStart/canPause/canCancel/canRetry) and use-task-actions.ts
// (40+ lines of batch operation qualification checks).
func computeAllowedActions(status, taskType string) []string {
	actions := []string{}
	switch taskType {
	case "sniff":
		// Sniff tasks: only delete supported.
		actions = append(actions, "delete")
	case "gallery":
		switch status {
		case "pending", "scrape_pending":
			actions = append(actions, "start", "pause", "delete")
	case "scraping", "downloading":
		actions = append(actions, "pause", "delete")
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
		case "transcoding":
			actions = append(actions, "cancel", "delete")
		default:
			actions = append(actions, "delete")
		}
	}
	return actions
}

// computeProgressStage returns an i18n key for the progress stage display.
// Previously frontend getProgressStage used hardcoded percentage thresholds
// (95%/97%/99%) which leaked backend download pipeline internals.
func computeProgressStage(status, taskType string, progress float64) string {
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
		// For downloading video: use progress thresholds as fallback
		// (kept for backwards compat, though backend could emit finer stages).
		if taskType == "gallery" {
			return "tasks.progressStageDownloading"
		}
		if progress >= 99 {
			return "tasks.progressStageProbing"
		}
		if progress >= 97 {
			return "tasks.progressStageTranscoding"
		}
		if progress >= 95 {
			return "tasks.progressStageMerging"
		}
		return "tasks.progressStageDownloading"
	}
}

// StripPersonFromTitle removes the person/model name prefix from a title.
// If the title starts with the person name, it strips the person name and
// any following separator characters ( -, —, –, :, |, spaces).
// If the title doesn't start with the person name, or if stripping would
// result in an empty string, the original title is returned unchanged.
//
// This replaces the frontend stripPersonFromTitle function that was removed
// during the business-logic backend migration (PuchiPix-2026-08-05-001-02).
// Gallery titles often follow the format "模特名 - 描述内容", and the tasks
// list should display only the description part in the title column.
func StripPersonFromTitle(title, person string) string {
	if title == "" || person == "" {
		return title
	}
	// Try stripping the full person string first (e.g. "ActorA, ActorB").
	if stripped := stripPersonPrefix(title, person); stripped != "" {
		return stripped
	}
	// If the person is a comma-separated list, try each individual name.
	for _, name := range strings.Split(person, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if stripped := stripPersonPrefix(title, name); stripped != "" {
			return stripped
		}
	}
	return title
}

// stripPersonPrefix is a helper that strips name from the beginning of title
// along with any following separator characters. Returns empty string if
// the title does not start with name or if stripping leaves an empty result.
func stripPersonPrefix(title, name string) string {
	if !strings.HasPrefix(title, name) {
		return ""
	}
	after := title[len(name):]
	// Remove leading separators: spaces, hyphens, em-dash, en-dash, colon, pipe
	after = strings.TrimLeft(after, " \t-\u2013\u2014:_|　")
	after = strings.TrimSpace(after)
	if after == "" {
		return "" // Don't return empty — fall back to original title
	}
	return after
}

// enrichTaskMap adds computed fields (EffectiveStatus, ProgressStage,
// AllowedActions) to a task map before sending to the frontend.
// This replaces the frontend logic that previously derived these values.
func enrichTaskMap(task map[string]any) map[string]any {
	status, _ := task["Status"].(string)
	// Map DB-internal "scraped" to frontend-visible "download_pending"
	// before any computation or response. The "scraped" status is set by
	// wire_executors.go after gallery scrape completes; it must not leak
	// to the frontend as-is because TaskStatus has no "scraped" member.
	if status == "scraped" {
		status = "download_pending"
		task["Status"] = status
	}
	taskType, _ := task["TaskType"].(string)
	imageCount, _ := task["ImageCount"].(int)
	videoCount, _ := task["VideoCount"].(int)
	progress, _ := task["Progress"].(float64)

	task["EffectiveStatus"] = computeEffectiveStatus(status, taskType, imageCount, videoCount)
	task["ProgressStage"] = computeProgressStage(status, taskType, progress)
	task["AllowedActions"] = computeAllowedActions(status, taskType)

	// Strip person/model name prefix from the title for display.
	// This replaces the frontend stripPersonFromTitle that was removed
	// during the business-logic backend migration.
	title, _ := task["GalleryTitle"].(string)
	person, _ := task["Person"].(string)
	if title != "" && person != "" {
		task["GalleryTitle"] = StripPersonFromTitle(title, person)
	}

	return task
}
