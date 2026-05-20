package model

import "time"

type VideoInfo struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	TaskID    uint      `gorm:"uniqueIndex;not null" json:"task_id"`
	Title     string    `json:"title"`
	Resolution string   `json:"resolution"`
	Duration  float64   `json:"duration"`
	FileSize  int64     `json:"file_size"`
	CreatedAt time.Time `json:"created_at"`
}

func (VideoInfo) TableName() string {
	return "video_infos"
}