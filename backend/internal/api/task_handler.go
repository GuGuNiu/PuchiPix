package api

import (
	"net/http"
	"time"

	"puchipix-backend/internal/config"
	"puchipix-backend/internal/database"
	"puchipix-backend/internal/downloader"
	"puchipix-backend/internal/model"
	"puchipix-backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	cfg *config.Config
}

func NewHandler(cfg *config.Config) *Handler {
	return &Handler{cfg: cfg}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	r.Use(h.corsMiddleware())

	r.Use(h.requestLogger())

	api := r.Group("/api")
	{
		api.GET("/health", h.healthCheck)

		api.GET("/ws", h.wsHandler)

		tasks := api.Group("/tasks")
		{
			tasks.GET("", h.listTasks)
			tasks.POST("", h.createTask)
			tasks.GET("/:id", h.getTask)
			tasks.PUT("/:id", h.updateTask)
			tasks.DELETE("/:id", h.deleteTask)
			tasks.POST("/:id/start", h.startTask)
			tasks.POST("/:id/pause", h.pauseTask)
			tasks.POST("/:id/resume", h.resumeTask)
			tasks.POST("/:id/cancel", h.cancelTask)
			tasks.POST("/:id/retry", h.retryTask)
		}

		sniff := api.Group("/sniff")
		{
			sniff.POST("/start", h.sniffStart)
			sniff.POST("/stop", h.sniffStop)
			sniff.GET("/status", h.sniffStatus)
			sniff.GET("/urls", h.sniffURLs)
			sniff.POST("/urls/:id/download", h.sniffDownloadURL)
		}

		api.GET("/config", h.getConfig)
		api.PUT("/config", h.updateConfig)

		api.GET("/history", h.getHistory)
		api.DELETE("/history", h.clearHistory)

		api.GET("/stats", h.getStats)
		api.GET("/system", h.getSystemStatus)
	}

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		c.File("./web/dist" + path)
	})
}

func (h *Handler) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if h.cfg.CORSEnabled {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Header("Access-Control-Max-Age", "86400")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func (h *Handler) requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method

		logger.Info("[%s] %s %d %v", method, path, status, latency)
	}
}

func (h *Handler) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"time":    time.Now().Unix(),
		"version": "1.0.0",
	})
}

func (h *Handler) wsHandler(c *gin.Context) {
	handleWebSocket(Hub, c.Writer, c.Request)
}

func (h *Handler) listTasks(c *gin.Context) {
	var tasks []model.DownloadTask
	query := database.DB.Preload("VideoInfo").Order("created_at DESC")

	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

func (h *Handler) createTask(c *gin.Context) {
	var req struct {
		URL    string `json:"url" binding:"required"`
		Format string `json:"format"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task := model.DownloadTask{
		URL:    req.URL,
		Status: model.TaskStatusPending,
		Format: "ts",
		Progress: 0,
	}

	if req.Format == "mp4" {
		task.Format = "mp4"
	}

	if err := database.DB.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	videoInfo := model.VideoInfo{
		TaskID: task.ID,
		Title:  task.URL,
	}
	database.DB.Create(&videoInfo)

	database.DB.Preload("VideoInfo").First(&task, task.ID)

	logger.Info("Task created: %d (URL: %s)", task.ID, task.URL)
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) getTask(c *gin.Context) {
	var task model.DownloadTask
	if err := database.DB.Preload("VideoInfo").First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	c.JSON(http.StatusOK, task)
}

func (h *Handler) updateTask(c *gin.Context) {
	var task model.DownloadTask
	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	var req struct {
		URL    string `json:"url"`
		Format string `json:"format"`
		M3U8URL string `json:"m3u8_url"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.URL != "" {
		updates["url"] = req.URL
	}
	if req.Format != "" {
		updates["format"] = req.Format
	}
	if req.M3U8URL != "" {
		updates["m3u8_url"] = req.M3U8URL
	}

	if len(updates) > 0 {
		database.DB.Model(&task).Updates(updates)
	}

	database.DB.Preload("VideoInfo").First(&task, task.ID)
	c.JSON(http.StatusOK, task)
}

func (h *Handler) deleteTask(c *gin.Context) {
	var task model.DownloadTask
	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.Status == model.TaskStatusDownloading {
		downloader.Manager.CancelDownload(task.ID)
	}

	database.DB.Delete(&task)
	logger.Info("Task deleted: %d", task.ID)
	c.JSON(http.StatusOK, gin.H{"message": "task deleted"})
}

func (h *Handler) startTask(c *gin.Context) {
	var task model.DownloadTask
	if err := database.DB.First(&task, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.Status == model.TaskStatusDownloading {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task already downloading"})
		return
	}

	m3u8URL := task.M3U8URL
	if m3u8URL == "" {
		m3u8URL = task.URL
	}

	task.M3U8URL = m3u8URL
	database.DB.Model(&task).Update("m3u8_url", m3u8URL)

	if err := downloader.Manager.StartDownload(&task); err != nil {
		logger.Error("Failed to start task %d: %v", task.ID, err)
		database.DB.Model(&task).Updates(map[string]interface{}{
			"status":    model.TaskStatusFailed,
			"error_msg": err.Error(),
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task started", "task_id": task.ID})
}

func (h *Handler) pauseTask(c *gin.Context) {
	id := c.Param("id")
	var task model.DownloadTask
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if err := downloader.Manager.PauseDownload(task.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task paused"})
}

func (h *Handler) resumeTask(c *gin.Context) {
	id := c.Param("id")
	var task model.DownloadTask
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if err := downloader.Manager.ResumeDownload(task.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task resumed"})
}

func (h *Handler) cancelTask(c *gin.Context) {
	id := c.Param("id")
	var task model.DownloadTask
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if err := downloader.Manager.CancelDownload(task.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task cancelled"})
}

func (h *Handler) retryTask(c *gin.Context) {
	id := c.Param("id")
	var task model.DownloadTask
	if err := database.DB.First(&task, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only failed or cancelled tasks can be retried"})
		return
	}

	database.DB.Model(&task).Updates(map[string]interface{}{
		"status":    model.TaskStatusPending,
		"progress":  0,
		"error_msg": "",
	})

	m3u8URL := task.M3U8URL
	if m3u8URL == "" {
		m3u8URL = task.URL
	}

	task.M3U8URL = m3u8URL

	if err := downloader.Manager.StartDownload(&task); err != nil {
		database.DB.Model(&task).Updates(map[string]interface{}{
			"status":    model.TaskStatusFailed,
			"error_msg": err.Error(),
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "task retrying", "task_id": task.ID})
}