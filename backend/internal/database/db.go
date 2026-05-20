package database

import (
	"puchipix-backend/pkg/logger"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var DB *gorm.DB

func Init(dbPath string) (*gorm.DB, error) {
	var err error
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Warn),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return nil, err
	}

	sqlDB.SetMaxOpenConns(1)

	if err := RunMigrations(DB); err != nil {
		return nil, err
	}

	logger.Info("Database initialized: %s", dbPath)
	return DB, nil
}

func Close() {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err == nil {
			sqlDB.Close()
		}
	}
}