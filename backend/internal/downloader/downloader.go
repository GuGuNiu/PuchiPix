package downloader

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"puchipix-backend/internal/config"
	"puchipix-backend/internal/database"
	"puchipix-backend/internal/model"
	"puchipix-backend/internal/transcoder"
	"puchipix-backend/pkg/logger"
)

type ProgressCallback func(ProgressUpdate)

type DownloadManager struct {
	cfg              *config.Config
	tasks            sync.Map
	progressCh       chan ProgressUpdate
	stopCh           chan struct{}
	progressCallback ProgressCallback
}

type ProgressUpdate struct {
	TaskID   uint
	Progress float64
	Speed    string
	Segment  int
	Total    int
	Status   model.TaskStatus
	Error    string
}

var Manager *DownloadManager

func InitManager(cfg *config.Config) *DownloadManager {
	Manager = &DownloadManager{
		cfg:        cfg,
		progressCh: make(chan ProgressUpdate, 100),
		stopCh:     make(chan struct{}),
	}
	go Manager.progressLoop()
	return Manager
}

func (dm *DownloadManager) SetProgressCallback(cb ProgressCallback) {
	dm.progressCallback = cb
}

func (dm *DownloadManager) progressLoop() {
	for {
		select {
		case update := <-dm.progressCh:
			dm.updateTaskProgress(update)
		case <-dm.stopCh:
			return
		}
	}
}

func (dm *DownloadManager) updateTaskProgress(update ProgressUpdate) {
	var task model.DownloadTask
	if err := database.DB.First(&task, update.TaskID).Error; err != nil {
		return
	}

	updates := map[string]interface{}{
		"progress":   update.Progress,
		"status":     update.Status,
		"updated_at": time.Now(),
	}

	if update.Error != "" {
		updates["error_msg"] = update.Error
	}

	database.DB.Model(&task).Updates(updates)

	if dm.progressCallback != nil {
		dm.progressCallback(update)
	}
}

type DownloadJob struct {
	Task      *model.DownloadTask
	Playlist  *M3U8Playlist
	StopFlag  int32
	PauseFlag int32
}

func (dm *DownloadManager) StartDownload(task *model.DownloadTask) error {
	if task.M3U8URL == "" {
		return fmt.Errorf("no M3U8 URL set for task %d", task.ID)
	}

	m3u8Content, err := FetchM3U8Content(task.M3U8URL)
	if err != nil {
		return fmt.Errorf("failed to fetch m3u8: %w", err)
	}

	playlist, err := ParseM3U8(m3u8Content, task.M3U8URL)
	if err != nil {
		return fmt.Errorf("failed to parse m3u8: %w", err)
	}

	if playlist.IsMaster && len(playlist.Variants) > 0 {
		variant := playlist.Variants[0]
		for _, v := range playlist.Variants {
			if v.Resolution != "" {
				variant = v
				break
			}
		}
		logger.Info("Task %d: Selected variant (resolution: %s, bandwidth: %d)", task.ID, variant.Resolution, variant.Bandwidth)

		variantContent, err := FetchM3U8Content(variant.FullURI)
		if err != nil {
			return fmt.Errorf("failed to fetch variant m3u8: %w", err)
		}
		playlist, err = ParseM3U8(variantContent, variant.FullURI)
		if err != nil {
			return fmt.Errorf("failed to parse variant m3u8: %w", err)
		}
	}

	if len(playlist.Segments) == 0 {
		return fmt.Errorf("no segments found in playlist")
	}

	job := &DownloadJob{
		Task:     task,
		Playlist: playlist,
	}

	dm.tasks.Store(task.ID, job)

	go dm.runDownload(job)
	return nil
}

func (dm *DownloadManager) runDownload(job *DownloadJob) {
	task := job.Task
	playlist := job.Playlist
	segDir := filepath.Join(dm.cfg.DownloadPath, fmt.Sprintf("task_%d_segments", task.ID))
	os.MkdirAll(segDir, 0755)

	totalSegments := len(playlist.Segments)
	logger.Info("Starting download task %d: %d segments", task.ID, totalSegments)

	dm.progressCh <- ProgressUpdate{
		TaskID:   task.ID,
		Progress: 0,
		Status:   model.TaskStatusDownloading,
		Total:    totalSegments,
	}

	var completedSegments int64
	var wg sync.WaitGroup
	sem := make(chan struct{}, dm.cfg.MaxConcurrent)
	var mu sync.Mutex
	var hasError bool

	for _, seg := range playlist.Segments {
		if atomic.LoadInt32(&job.StopFlag) == 1 {
			break
		}

		for atomic.LoadInt32(&job.PauseFlag) == 1 {
			if atomic.LoadInt32(&job.StopFlag) == 1 {
				break
			}
			dm.progressCh <- ProgressUpdate{
				TaskID:   task.ID,
				Progress: float64(completedSegments) / float64(totalSegments) * 100,
				Status:   model.TaskStatusPaused,
				Segment:  int(completedSegments),
				Total:    totalSegments,
			}
			time.Sleep(500 * time.Millisecond)
		}

		if atomic.LoadInt32(&job.StopFlag) == 1 {
			break
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(s SegmentInfo) {
			defer wg.Done()
			defer func() { <-sem }()

			segDownloader := NewSegmentDownloader(s.FullURI, segDir, s.Index, dm.cfg.SegmentRetries)
			result := segDownloader.Download()

			mu.Lock()
			if result.Error != nil {
				logger.Error("Failed to download segment %d: %v", s.Index, result.Error)
				hasError = true
			} else {
				atomic.AddInt64(&completedSegments, 1)
			}
			mu.Unlock()

			done := atomic.LoadInt64(&completedSegments)
			progress := float64(done) / float64(totalSegments) * 100

			dm.progressCh <- ProgressUpdate{
				TaskID:   task.ID,
				Progress: progress,
				Segment:  int(done),
				Total:    totalSegments,
				Status:   model.TaskStatusDownloading,
			}
		}(seg)
	}

	wg.Wait()

	if atomic.LoadInt32(&job.StopFlag) == 1 {
		dm.progressCh <- ProgressUpdate{
			TaskID: task.ID,
			Status: model.TaskStatusCancelled,
			Error:  "cancelled by user",
		}
		CleanupSegments(segDir)
		dm.tasks.Delete(task.ID)
		return
	}

	if hasError {
		dm.progressCh <- ProgressUpdate{
			TaskID: task.ID,
			Status: model.TaskStatusFailed,
			Error:  "some segments failed to download",
		}
		dm.tasks.Delete(task.ID)
		return
	}

	if task.Format == "mp4" {
		dm.progressCh <- ProgressUpdate{
			TaskID:   task.ID,
			Progress: 100,
			Status:   model.TaskStatusTranscoding,
			Segment:  totalSegments,
			Total:    totalSegments,
		}

		outputPath := filepath.Join(dm.cfg.DownloadPath, fmt.Sprintf("task_%d.mp4", task.ID))
		if err := transcoder.TranscodeTS(segDir, outputPath, totalSegments); err != nil {
			logger.Error("Transcoding failed for task %d: %v", task.ID, err)
			dm.progressCh <- ProgressUpdate{
				TaskID: task.ID,
				Status: model.TaskStatusFailed,
				Error:  fmt.Sprintf("transcoding failed: %v", err),
			}
			dm.tasks.Delete(task.ID)
			return
		}

		fileInfo, _ := os.Stat(outputPath)
		fileSize := int64(0)
		if fileInfo != nil {
			fileSize = fileInfo.Size()
		}

		dm.progressCh <- ProgressUpdate{
			TaskID:   task.ID,
			Progress: 100,
			Status:   model.TaskStatusCompleted,
			Segment:  totalSegments,
			Total:    totalSegments,
		}

		var videoInfo model.VideoInfo
		database.DB.Where("task_id = ?", task.ID).First(&videoInfo)
		database.DB.Model(&videoInfo).Updates(map[string]interface{}{
			"file_size": fileSize,
		})

		database.DB.Model(&task).Updates(map[string]interface{}{
			"file_path": outputPath,
			"progress":  100,
		})

		CleanupSegments(segDir)
	} else {
		outputPath := filepath.Join(dm.cfg.DownloadPath, fmt.Sprintf("task_%d.ts", task.ID))
		if err := MergeSegments(segDir, outputPath, totalSegments); err != nil {
			logger.Error("Failed to merge segments for task %d: %v", task.ID, err)
			dm.progressCh <- ProgressUpdate{
				TaskID: task.ID,
				Status: model.TaskStatusFailed,
				Error:  fmt.Sprintf("merge failed: %v", err),
			}
			dm.tasks.Delete(task.ID)
			return
		}

		fileInfo, _ := os.Stat(outputPath)
		fileSize := int64(0)
		if fileInfo != nil {
			fileSize = fileInfo.Size()
		}

		var videoInfo model.VideoInfo
		database.DB.Where("task_id = ?", task.ID).First(&videoInfo)
		database.DB.Model(&videoInfo).Updates(map[string]interface{}{
			"file_size": fileSize,
		})

		database.DB.Model(&task).Updates(map[string]interface{}{
			"file_path": outputPath,
			"progress":  100,
			"status":    model.TaskStatusCompleted,
		})

		dm.progressCh <- ProgressUpdate{
			TaskID:   task.ID,
			Progress: 100,
			Status:   model.TaskStatusCompleted,
			Segment:  totalSegments,
			Total:    totalSegments,
		}

		CleanupSegments(segDir)
	}

	dm.tasks.Delete(task.ID)
}

func (dm *DownloadManager) PauseDownload(taskID uint) error {
	val, ok := dm.tasks.Load(taskID)
	if !ok {
		return fmt.Errorf("no active download for task %d", taskID)
	}
	job := val.(*DownloadJob)
	atomic.StoreInt32(&job.PauseFlag, 1)

	database.DB.Model(&model.DownloadTask{}).Where("id = ?", taskID).Updates(map[string]interface{}{
		"status": model.TaskStatusPaused,
	})
	return nil
}

func (dm *DownloadManager) ResumeDownload(taskID uint) error {
	val, ok := dm.tasks.Load(taskID)
	if !ok {
		return fmt.Errorf("no active download for task %d", taskID)
	}
	job := val.(*DownloadJob)
	atomic.StoreInt32(&job.PauseFlag, 0)

	database.DB.Model(&model.DownloadTask{}).Where("id = ?", taskID).Updates(map[string]interface{}{
		"status": model.TaskStatusDownloading,
	})
	return nil
}

func (dm *DownloadManager) CancelDownload(taskID uint) error {
	val, ok := dm.tasks.Load(taskID)
	if !ok {
		var task model.DownloadTask
		if err := database.DB.First(&task, taskID).Error; err != nil {
			return fmt.Errorf("task %d not found", taskID)
		}
		database.DB.Model(&task).Updates(map[string]interface{}{
			"status": model.TaskStatusCancelled,
		})
		return nil
	}
	job := val.(*DownloadJob)
	atomic.StoreInt32(&job.StopFlag, 1)
	atomic.StoreInt32(&job.PauseFlag, 0)
	return nil
}

func (dm *DownloadManager) IsDownloading(taskID uint) bool {
	_, ok := dm.tasks.Load(taskID)
	return ok
}

func (dm *DownloadManager) Stop() {
	close(dm.stopCh)
}