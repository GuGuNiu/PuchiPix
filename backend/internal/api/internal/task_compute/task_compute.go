package task_compute

import "strings"

// ComputeEffectiveStatus determines the display status used for filtering.
func ComputeEffectiveStatus(status, taskType string, imageCount, videoCount int) string {
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
		return "download_pending"
	default:
		return status
	}
}

// ComputeAllowedActions returns the list of actions the user can perform on
// a task, based on its type and current status.
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

// ComputeProgressStage returns an i18n key for the progress stage display.
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
func StripPersonFromTitle(title, person string) string {
	if title == "" || person == "" {
		return title
	}
	if stripped := stripPersonPrefix(title, person); stripped != "" {
		return stripped
	}
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

func stripPersonPrefix(title, name string) string {
	if !strings.HasPrefix(title, name) {
		return ""
	}
	after := title[len(name):]
	after = strings.TrimLeft(after, " \t-\u2013\u2014:_|　")
	after = strings.TrimSpace(after)
	if after == "" {
		return ""
	}
	return after
}

// EnrichTaskMap adds computed fields (EffectiveStatus, ProgressStage,
// AllowedActions) to a task map before sending to the frontend.
func EnrichTaskMap(task map[string]any) map[string]any {
	status, _ := task["Status"].(string)
	if status == "scraped" {
		status = "download_pending"
		task["Status"] = status
	}
	taskType, _ := task["TaskType"].(string)
	imageCount, _ := task["ImageCount"].(int)
	videoCount, _ := task["VideoCount"].(int)
	progress, _ := task["Progress"].(float64)

	task["EffectiveStatus"] = ComputeEffectiveStatus(status, taskType, imageCount, videoCount)
	task["ProgressStage"] = ComputeProgressStage(status, taskType, progress)
	task["AllowedActions"] = ComputeAllowedActions(status, taskType)

	title, _ := task["GalleryTitle"].(string)
	person, _ := task["Person"].(string)
	if title != "" && person != "" {
		task["GalleryTitle"] = StripPersonFromTitle(title, person)
	}

	return task
}
