use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::Running => "running",
            TaskStatus::Paused => "paused",
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
            TaskStatus::Cancelled => "cancelled",
        }
    }

    pub fn css_class(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "badge-pending",
            TaskStatus::Running => "badge-running",
            TaskStatus::Paused => "badge-paused",
            TaskStatus::Completed => "badge-completed",
            TaskStatus::Failed => "badge-failed",
            TaskStatus::Cancelled => "badge-cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    pub url: String,
    pub filename: Option<String>,
    pub quality: Option<String>,
    pub transcode_to_mp4: Option<bool>,
    pub status: TaskStatus,
    pub progress: Option<f64>,
    pub speed: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskCreateRequest {
    pub url: String,
    pub quality: Option<String>,
    pub transcode_to_mp4: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BatchImportRequest {
    pub urls: Vec<String>,
    pub quality: Option<String>,
    pub transcode_to_mp4: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskActionResponse {
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Config {
    pub chromedriver_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub download_path: Option<String>,
    pub concurrency: Option<u32>,
    pub default_transcode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SniffControlRequest {
    pub target_url: Option<String>,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SniffResult {
    pub url: String,
    pub quality: Option<String>,
    pub title: Option<String>,
    pub detected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SniffStatus {
    pub active: bool,
    pub target_url: Option<String>,
    pub results: Vec<SniffResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Stats {
    pub total_tasks: u32,
    pub active_tasks: u32,
    pub completed_tasks: u32,
    pub failed_tasks: u32,
    pub download_speed: Option<String>,
    pub total_size: u64,
    pub total_size_str: String,
    pub avg_speed: f64,
    pub avg_speed_str: String,
    pub current_speed: f64,
    pub current_speed_str: String,
    pub speed_rating: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SystemMemory {
    pub alloc_mb: String,
    pub sys_mb: String,
    pub total_mb: String,
    pub gc_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SystemStatus {
    pub memory: SystemMemory,
    pub goroutines: i32,
    pub uptime: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryItem {
    pub id: String,
    pub url: String,
    pub filename: Option<String>,
    pub completed_at: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryResponse {
    pub items: Vec<HistoryItem>,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub error: String,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub data: Option<serde_json::Value>,
}