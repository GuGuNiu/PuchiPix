package api

import (
	"net/http"
	"strconv"

	"puchipix-backend/internal/database"
	"puchipix-backend/internal/downloader"
	"puchipix-backend/internal/model"
	"puchipix-backend/internal/sniff"
	"puchipix-backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

func (h *Handler) sniffStart(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sniffer := sniff.GetInstance()
	status := sniffer.GetStatus()
	if status.Running {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sniffer already running"})
		return
	}

	if err := sniffer.Start(h.cfg.ChromeDriverPath, req.URL); err != nil {
		logger.Error("Failed to start sniffer: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "sniffer started",
		"target":  req.URL,
	})
}

func (h *Handler) sniffStop(c *gin.Context) {
	sniffer := sniff.GetInstance()
	if err := sniffer.Stop(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "sniffer stopped"})
}

func (h *Handler) sniffStatus(c *gin.Context) {
	sniffer := sniff.GetInstance()
	status := sniffer.GetStatus()
	c.JSON(http.StatusOK, status)
}

func (h *Handler) sniffURLs(c *gin.Context) {
	sniffer := sniff.GetInstance()
	urls := sniffer.GetCapturedURLs()

	urlType := c.Query("type")
	if urlType == "m3u8" {
		urls = sniffer.GetM3U8URLs()
	}

	c.JSON(http.StatusOK, urls)
}

func (h *Handler) sniffDownloadURL(c *gin.Context) {
	idStr := c.Param("id")
	index, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	sniffer := sniff.GetInstance()
	urls := sniffer.GetM3U8URLs()

	if index < 0 || index >= len(urls) {
		c.JSON(http.StatusNotFound, gin.H{"error": "url not found"})
		return
	}

	capturedURL := urls[index]

	task := model.DownloadTask{
		URL:     capturedURL.PageURL,
		M3U8URL: capturedURL.URL,
		Status:  model.TaskStatusPending,
		Format:  "ts",
	}

	if err := database.DB.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	videoInfo := model.VideoInfo{
		TaskID: task.ID,
		Title:  capturedURL.Filename,
	}
	database.DB.Create(&videoInfo)

	if err := downloader.Manager.StartDownload(&task); err != nil {
		logger.Error("Failed to start download from sniffed URL: %v", err)
		database.DB.Model(&task).Updates(map[string]interface{}{
			"status":    model.TaskStatusFailed,
			"error_msg": err.Error(),
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	logger.Info("Download started from sniffed URL: task=%d, url=%s", task.ID, capturedURL.URL)
	c.JSON(http.StatusCreated, gin.H{
		"message": "download started",
		"task_id": task.ID,
	})
}