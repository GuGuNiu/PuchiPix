package model

import (
	"time"

	"gorm.io/gorm"
)

type TaskStatus string

const (
	TaskStatusPending     TaskStatus = "pending"
	TaskStatusDownloading TaskStatus = "downloading"
	TaskStatusPaused      TaskStatus = "paused"
	TaskStatusCompleted   TaskStatus = "completed"
	TaskStatusFailed      TaskStatus = "failed"
	TaskStatusCancelled   TaskStatus = "cancelled"
	TaskStatusTranscoding TaskStatus = "transcoding"
)

type DownloadTask struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	URL       string     `gorm:"not null" json:"url"`
	M3U8URL   string     `json:"m3u8_url"`
	Status    TaskStatus `gorm:"default:pending;not null;index" json:"status"`
	Progress  float64    `gorm:"default:0" json:"progress"`
	FilePath  string     `json:"file_path"`
	Format    string     `gorm:"default:ts" json:"format"`
	ErrorMsg  string     `json:"error_msg"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	VideoInfo *VideoInfo `gorm:"foreignKey:TaskID" json:"video_info,omitempty"`
}

func (DownloadTask) TableName() string {
	return "download_tasks"
}