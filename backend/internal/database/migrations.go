package database

import (
	"puchipix-backend/internal/model"

	"gorm.io/gorm"
)

func RunMigrations(db *gorm.DB) error {
	return db.AutoMigrate(
		&model.DownloadTask{},
		&model.VideoInfo{},
		&model.AppConfig{},
	)
}
