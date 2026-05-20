package api

import (
	"net/http"
	"strconv"

	"puchipix-backend/internal/database"
	"puchipix-backend/internal/model"
	"puchipix-backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

func (h *Handler) getConfig(c *gin.Context) {
	var configs []model.AppConfig
	if err := database.DB.Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	configMap := make(map[string]string)
	for _, cfg := range configs {
		configMap[cfg.Key] = cfg.Value
	}

	if len(configMap) == 0 {
		configMap = map[string]string{
			"max_concurrent":    "5",
			"segment_retries":   "3",
			"default_format":    "ts",
			"download_path":     h.cfg.DownloadPath,
			"chromedriver_path": h.cfg.ChromeDriverPath,
			"ffmpeg_path":       h.cfg.FFmpegPath,
		}
	}

	c.JSON(http.StatusOK, configMap)
}

func (h *Handler) updateConfig(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for key, value := range req {
		var cfg model.AppConfig
		result := database.DB.Where("key = ?", key).First(&cfg)
		if result.Error != nil {
			newCfg := model.AppConfig{
				Key:   key,
				Value: value,
			}
			database.DB.Create(&newCfg)
		} else {
			database.DB.Model(&cfg).Update("value", value)
		}

		switch key {
		case "max_concurrent":
			if v, err := strconv.Atoi(value); err == nil {
				h.cfg.MaxConcurrent = v
			}
		case "segment_retries":
			if v, err := strconv.Atoi(value); err == nil {
				h.cfg.SegmentRetries = v
			}
		case "download_path":
			h.cfg.DownloadPath = value
		case "chromedriver_path":
			h.cfg.ChromeDriverPath = value
		case "ffmpeg_path":
			h.cfg.FFmpegPath = value
		}
	}

	h.cfg.Save()

	logger.Info("Configuration updated")
	c.JSON(http.StatusOK, gin.H{"message": "config updated"})
}