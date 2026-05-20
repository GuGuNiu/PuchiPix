use crate::models::*;
use gloo_net::http::Request;

const API_BASE: &str = "http://localhost:10540/api";

pub struct ApiClient;

impl ApiClient {
    async fn fetch_json<T: for<'de> serde::Deserialize<'de>>(url: &str) -> Result<T, String> {
        let resp = Request::get(url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.ok() {
            resp.json::<T>()
                .await
                .map_err(|e| format!("JSON parse failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("HTTP {}: {}", status, text))
        }
    }

    async fn post_json<T: for<'de> serde::Deserialize<'de>>(
        url: &str,
        body: &impl serde::Serialize,
    ) -> Result<T, String> {
        let body_str = serde_json::to_string(body).map_err(|e| format!("Serialize failed: {}", e))?;
        let resp = Request::post(url)
            .header("Content-Type", "application/json")
            .body(body_str)
            .map_err(|e| format!("Body error: {}", e))?
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.ok() {
            resp.json::<T>()
                .await
                .map_err(|e| format!("JSON parse failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("HTTP {}: {}", status, text))
        }
    }

    async fn put_json<T: for<'de> serde::Deserialize<'de>>(
        url: &str,
        body: &impl serde::Serialize,
    ) -> Result<T, String> {
        let body_str = serde_json::to_string(body).map_err(|e| format!("Serialize failed: {}", e))?;
        let resp = Request::put(url)
            .header("Content-Type", "application/json")
            .body(body_str)
            .map_err(|e| format!("Body error: {}", e))?
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.ok() {
            resp.json::<T>()
                .await
                .map_err(|e| format!("JSON parse failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("HTTP {}: {}", status, text))
        }
    }

    async fn delete_json<T: for<'de> serde::Deserialize<'de>>(url: &str) -> Result<T, String> {
        let resp = Request::delete(url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.ok() {
            resp.json::<T>()
                .await
                .map_err(|e| format!("JSON parse failed: {}", e))
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(format!("HTTP {}: {}", status, text))
        }
    }

    pub async fn get_stats() -> Result<Stats, String> {
        Self::fetch_json::<Stats>(&format!("{}/stats", API_BASE)).await
    }

    pub async fn get_system_status() -> Result<SystemStatus, String> {
        Self::fetch_json::<SystemStatus>(&format!("{}/system", API_BASE)).await
    }

    pub async fn get_tasks() -> Result<Vec<Task>, String> {
        Self::fetch_json::<Vec<Task>>(&format!("{}/tasks", API_BASE)).await
    }

    pub async fn create_task(req: &TaskCreateRequest) -> Result<Task, String> {
        Self::post_json::<Task>(&format!("{}/tasks", API_BASE), req).await
    }

    pub async fn batch_import(req: &BatchImportRequest) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(&format!("{}/tasks/batch", API_BASE), req).await
    }

    pub async fn start_task(id: &str) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/tasks/{}/start", API_BASE, id),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn pause_task(id: &str) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/tasks/{}/pause", API_BASE, id),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn cancel_task(id: &str) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/tasks/{}/cancel", API_BASE, id),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn delete_task(id: &str) -> Result<TaskActionResponse, String> {
        Self::delete_json::<TaskActionResponse>(&format!("{}/tasks/{}", API_BASE, id)).await
    }

    pub async fn retry_task(id: &str) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/tasks/{}/retry", API_BASE, id),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn get_config() -> Result<Config, String> {
        Self::fetch_json::<Config>(&format!("{}/config", API_BASE)).await
    }

    pub async fn update_config(config: &Config) -> Result<TaskActionResponse, String> {
        Self::put_json::<TaskActionResponse>(&format!("{}/config", API_BASE), config).await
    }

    pub async fn get_sniff_status() -> Result<SniffStatus, String> {
        Self::fetch_json::<SniffStatus>(&format!("{}/sniff", API_BASE)).await
    }

    pub async fn start_sniff(target_url: &str) -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/sniff/start", API_BASE),
            &SniffControlRequest {
                target_url: Some(target_url.to_string()),
                action: "start".to_string(),
            },
        )
        .await
    }

    pub async fn stop_sniff() -> Result<TaskActionResponse, String> {
        Self::post_json::<TaskActionResponse>(
            &format!("{}/sniff/stop", API_BASE),
            &SniffControlRequest {
                target_url: None,
                action: "stop".to_string(),
            },
        )
        .await
    }

    pub async fn get_history(page: Option<u32>, query: Option<&str>) -> Result<HistoryResponse, String> {
        let mut url = format!("{}/history", API_BASE);
        let mut params = Vec::new();
        if let Some(p) = page {
            params.push(format!("page={}", p));
        }
        if let Some(q) = query {
            params.push(format!("q={}", url_encode(q)));
        }
        if !params.is_empty() {
            url.push_str("?");
            url.push_str(&params.join("&"));
        }
        Self::fetch_json::<HistoryResponse>(&url).await
    }

    pub async fn clear_history() -> Result<TaskActionResponse, String> {
        Self::delete_json::<TaskActionResponse>(&format!("{}/history", API_BASE)).await
    }
}

fn url_encode(s: &str) -> String {
    s.replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('+', "%2B")
}