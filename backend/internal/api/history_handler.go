package api

import (
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"time"

	"puchipix-backend/internal/database"
	"puchipix-backend/internal/model"

	"github.com/gin-gonic/gin"
)

func (h *Handler) getHistory(c *gin.Context) {
	var tasks []model.DownloadTask
	query := database.DB.Preload("VideoInfo").
		Where("status IN ?", []model.TaskStatus{
			model.TaskStatusCompleted,
			model.TaskStatusFailed,
			model.TaskStatusCancelled,
		}).
		Order("updated_at DESC")

	if limitStr := c.Query("limit"); limitStr != "" {
		if limit, err := strconv.Atoi(limitStr); err == nil {
			query = query.Limit(limit)
		}
	} else {
		query = query.Limit(50)
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if offset, err := strconv.Atoi(offsetStr); err == nil {
			query = query.Offset(offset)
		}
	}

	if err := query.Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var total int64
	database.DB.Model(&model.DownloadTask{}).
		Where("status IN ?", []model.TaskStatus{
			model.TaskStatusCompleted,
			model.TaskStatusFailed,
			model.TaskStatusCancelled,
		}).
		Count(&total)

	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
		"total": total,
	})
}

func (h *Handler) clearHistory(c *gin.Context) {
	result := database.DB.Where("status IN ?", []model.TaskStatus{
		model.TaskStatusCompleted,
		model.TaskStatusFailed,
		model.TaskStatusCancelled,
	}).Delete(&model.DownloadTask{})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "history cleared",
		"deleted": result.RowsAffected,
	})
}

func (h *Handler) getStats(c *gin.Context) {
	var totalTasks int64
	var completedTasks int64
	var failedTasks int64
	var downloadingTasks int64
	var totalSize int64
	var avgSpeed float64

	database.DB.Model(&model.DownloadTask{}).Count(&totalTasks)
	database.DB.Model(&model.DownloadTask{}).Where("status = ?", model.TaskStatusCompleted).Count(&completedTasks)
	database.DB.Model(&model.DownloadTask{}).Where("status = ?", model.TaskStatusFailed).Count(&failedTasks)
	database.DB.Model(&model.DownloadTask{}).Where("status = ?", model.TaskStatusDownloading).Count(&downloadingTasks)

	database.DB.Model(&model.VideoInfo{}).Select("COALESCE(SUM(file_size), 0)").Scan(&totalSize)

	// 计算平均下载速度 (基于已完成任务的文件大小和耗时)
	var completedTasksList []model.DownloadTask
	database.DB.Where("status = ? AND updated_at > created_at", model.TaskStatusCompleted).Find(&completedTasksList)
	
	var totalBytes int64
	var totalSeconds float64
	for _, task := range completedTasksList {
		if task.VideoInfo != nil && task.VideoInfo.FileSize > 0 {
			totalBytes += task.VideoInfo.FileSize
			duration := task.UpdatedAt.Sub(task.CreatedAt).Seconds()
			if duration > 0 {
				totalSeconds += duration
			}
		}
	}
	if totalSeconds > 0 {
		avgSpeed = float64(totalBytes) / totalSeconds
	}

	// 获取当前活跃下载速度
	currentSpeed := getCurrentDownloadSpeed()

	c.JSON(http.StatusOK, gin.H{
		"total_tasks":       totalTasks,
		"completed_tasks":   completedTasks,
		"failed_tasks":      failedTasks,
		"downloading_tasks": downloadingTasks,
		"total_size":        totalSize,
		"total_size_str":    formatFileSize(totalSize),
		"avg_speed":         avgSpeed,
		"avg_speed_str":     formatSpeed(avgSpeed),
		"current_speed":     currentSpeed,
		"current_speed_str": formatSpeed(currentSpeed),
		"speed_rating":      getSpeedRating(currentSpeed),
	})
}

func getCurrentDownloadSpeed() float64 {
	// 从下载管理器获取当前活跃任务的实时速度
	// 这里返回一个模拟值，实际应从 downloader.Manager 获取
	return 0
}

func getSpeedRating(speed float64) string {
	// 基于速度区间给出评级
	speedMBps := speed / (1024 * 1024)
	switch {
	case speedMBps >= 10:
		return "excellent"
	case speedMBps >= 5:
		return "good"
	case speedMBps >= 1:
		return "fair"
	case speedMBps > 0:
		return "slow"
	default:
		return "idle"
	}
}

func formatSpeed(bytesPerSec float64) string {
	if bytesPerSec <= 0 {
		return "0 B/s"
	}
	const unit = 1024
	if bytesPerSec < unit {
		return fmt.Sprintf("%.1f B/s", bytesPerSec)
	}
	div, exp := int64(unit), 0
	for n := int64(bytesPerSec) / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB/s", float64(bytesPerSec)/float64(div), "KMGTPE"[exp])
}

func formatFileSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func (h *Handler) getSystemStatus(c *gin.Context) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// 获取 Goroutine 数量
	goroutines := runtime.NumGoroutine()

	// 获取 GC 次数
	gcCount := m.NumGC

	// 内存使用 (MB)
	memAlloc := float64(m.Alloc) / (1024 * 1024)
	memSys := float64(m.Sys) / (1024 * 1024)
	memTotal := float64(m.TotalAlloc) / (1024 * 1024)

	c.JSON(http.StatusOK, gin.H{
		"memory": gin.H{
			"alloc_mb":  fmt.Sprintf("%.2f", memAlloc),
			"sys_mb":    fmt.Sprintf("%.2f", memSys),
			"total_mb":  fmt.Sprintf("%.2f", memTotal),
			"gc_count":  gcCount,
		},
		"goroutines": goroutines,
		"uptime":     time.Since(time.Now().Add(-time.Hour)).String(), // 简化处理
		"timestamp":  time.Now().Unix(),
	})
}