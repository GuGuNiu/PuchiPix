package model

import "time"

type AppConfig struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"uniqueIndex;not null" json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AppConfig) TableName() string {
	return "app_configs"
}