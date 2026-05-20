package main

import (
	"os"

	"puchipix-backend/internal/api"
	"puchipix-backend/internal/config"
	"puchipix-backend/internal/database"
	"puchipix-backend/internal/downloader"
	"puchipix-backend/pkg/logger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Failed to load config: %v", err)
	}

	logger.Init(cfg.LogLevel)
	logger.Info("PuchiPix M3U8 Downloader starting...")

	_, err = database.Init(cfg.DBPath)
	if err != nil {
		logger.Fatal("Failed to initialize database: %v", err)
	}
	defer database.Close()

	downloader.InitManager(cfg)

	r := api.SetupRouter(cfg)

	addr := ":" + cfg.Port
	logger.Info("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		logger.Fatal("Failed to start server: %v", err)
	}
}

func init() {
	os.Setenv("TZ", "Asia/Shanghai")

}
