use yew::prelude::*;
use crate::models::*;
use crate::api::ApiClient;

#[function_component]
pub fn TaskList() -> Html {
    let tasks = use_state(|| Vec::<Task>::new());
    let loading = use_state(|| true);
    let error = use_state(|| None::<String>);
    let url_input = use_state(String::new);
    let quality = use_state(|| "best".to_string());
    let transcode = use_state(|| false);
    let batch_text = use_state(String::new);
    let show_batch = use_state(|| false);
    let expanded_task = use_state(|| None::<String>);
    let toast = use_state(|| None::<(String, String)>);

    let fetch_tasks = {
        let tasks = tasks.clone();
        let loading = loading.clone();
        let error = error.clone();
        Callback::from(move |_| {
            let tasks = tasks.clone();
            let loading = loading.clone();
            let error = error.clone();
            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                match ApiClient::get_tasks().await {
                    Ok(t) => {
                        tasks.set(t);
                        error.set(None);
                    }
                    Err(e) => error.set(Some(e)),
                }
                loading.set(false);
            });
        })
    };

    {
        let fetch = fetch_tasks.clone();
        use_effect_with_deps(move |_| {
            fetch.emit(());
            || {}
        }, ());
    }

    let show_toast = {
        let toast = toast.clone();
        Callback::from(move |(msg, level): (String, String)| {
            toast.set(Some((msg, level)));
            let toast = toast.clone();
            let timeout = gloo_timers::callback::Timeout::new(3000, move || {
                toast.set(None);
            });
            timeout.forget();
        })
    };

    let on_add = {
        let url_input = url_input.clone();
        let quality = quality.clone();
        let transcode = transcode.clone();
        let fetch_tasks = fetch_tasks.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let url = (*url_input).clone();
            if url.trim().is_empty() {
                show_toast.emit(("Please enter an M3U8 URL".to_string(), "warning".to_string()));
                return;
            }
            let q = (*quality).clone();
            let tc = *transcode;
            let fetch_tasks = fetch_tasks.clone();
            let show_toast = show_toast.clone();
            let url_input = url_input.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::create_task(&TaskCreateRequest {
                    url: url.trim().to_string(),
                    quality: Some(q),
                    transcode_to_mp4: Some(tc),
                }).await {
                    Ok(_) => {
                        url_input.set(String::new());
                        show_toast.emit(("Task created successfully".to_string(), "success".to_string()));
                        fetch_tasks.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to create task: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    let on_batch_import = {
        let batch_text = batch_text.clone();
        let quality = quality.clone();
        let transcode = transcode.clone();
        let fetch_tasks = fetch_tasks.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let text = (*batch_text).clone();
            if text.trim().is_empty() {
                show_toast.emit(("Please enter URLs to import".to_string(), "warning".to_string()));
                return;
            }
            let urls: Vec<String> = text
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            if urls.is_empty() {
                show_toast.emit(("No valid URLs found".to_string(), "warning".to_string()));
                return;
            }
            let q = (*quality).clone();
            let tc = *transcode;
            let fetch_tasks = fetch_tasks.clone();
            let show_toast = show_toast.clone();
            let batch_text = batch_text.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::batch_import(&BatchImportRequest {
                    urls,
                    quality: Some(q),
                    transcode_to_mp4: Some(tc),
                }).await {
                    Ok(resp) => {
                        batch_text.set(String::new());
                        let msg = resp.message.unwrap_or_else(|| "Batch import completed".to_string());
                        show_toast.emit((msg, "success".to_string()));
                        fetch_tasks.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Batch import failed: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    let on_action = {
        let fetch_tasks = fetch_tasks.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |(id, action): (String, String)| {
            let fetch_tasks = fetch_tasks.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let result = match action.as_str() {
                    "start" => ApiClient::start_task(&id).await,
                    "pause" => ApiClient::pause_task(&id).await,
                    "cancel" => ApiClient::cancel_task(&id).await,
                    "delete" => ApiClient::delete_task(&id).await,
                    "retry" => ApiClient::retry_task(&id).await,
                    _ => Err("Unknown action".to_string()),
                };
                match result {
                    Ok(resp) => {
                        let msg = resp.message.unwrap_or_else(|| format!("Task {} successful", action));
                        show_toast.emit((msg, "success".to_string()));
                        fetch_tasks.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Action failed: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    let toggle_expand = {
        let expanded_task = expanded_task.clone();
        Callback::from(move |id: String| {
            if let Some(ref current) = *expanded_task {
                if current == &id {
                    expanded_task.set(None);
                    return;
                }
            }
            expanded_task.set(Some(id));
        })
    };

    html! {
        <div>
            <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: var(--text-primary);">
                { "Task Management" }
            </h2>

            if let Some((msg, level)) = &*toast {
                <div class={classes!("toast", format!("toast-{}", level))}
                     style="position: static; margin-bottom: 16px; animation: none; max-width: none;">
                    { msg }
                </div>
            }

            if let Some(err) = &*error {
                <div class="error-message">{ format!("Error: {}", err) }</div>
            }

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <div class="card-title">{ "Add New Task" }</div>
                </div>
                <div class="task-toolbar">
                    <div class="form-group">
                        <label>{ "M3U8 URL" }</label>
                        <input
                            type="text"
                            placeholder="https://example.com/stream.m3u8"
                            value={(*url_input).clone()}
                            oninput={let u = url_input.clone(); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                u.set(input.value());
                            })}
                        />
                    </div>
                    <div class="form-group" style="min-width: 140px; flex: 0;">
                        <label>{ "Quality" }</label>
                        <select
                            value={(*quality).clone()}
                            onchange={let q = quality.clone(); Callback::from(move |e: Event| {
                                let select = e.target_unchecked_into::<web_sys::HtmlSelectElement>();
                                q.set(select.value());
                            })}
                        >
                            <option value="best">{ "Best" }</option>
                            <option value="1080p">{ "1080p" }</option>
                            <option value="720p">{ "720p" }</option>
                            <option value="480p">{ "480p" }</option>
                            <option value="360p">{ "360p" }</option>
                        </select>
                    </div>
                    <div class="form-group" style="min-width: auto; flex: 0;">
                        <div class="checkbox-group" style="padding-top: 24px;">
                            <input
                                type="checkbox"
                                id="transcode"
                                checked={*transcode}
                                onchange={let t = transcode.clone(); Callback::from(move |e: Event| {
                                    let checkbox = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                    t.set(checkbox.checked());
                                })}
                            />
                            <label for="transcode">{ "Transcode to MP4" }</label>
                        </div>
                    </div>
                    <div style="padding-top: 24px;">
                        <button class="btn btn-primary" onclick={on_add}>
                            { "Add Task" }
                        </button>
                    </div>
                </div>

                <div class="batch-import-area">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span style="color: var(--text-secondary); font-size: 13px; font-weight: 500;">
                            { "Batch Import" }
                        </span>
                        <button
                            class="btn btn-ghost btn-sm"
                            onclick={let s = show_batch.clone(); Callback::from(move |_| {
                                let current = *s;
                                s.set(!current);
                            })}
                        >
                            { if *show_batch { "Hide" } else { "Expand" } }
                        </button>
                    </div>
                    if *show_batch {
                        <textarea
                            placeholder="Paste multiple M3U8 URLs, one per line"
                            value={(*batch_text).clone()}
                            oninput={let b = batch_text.clone(); Callback::from(move |e: InputEvent| {
                                let ta = e.target_unchecked_into::<web_sys::HtmlTextAreaElement>();
                                b.set(ta.value());
                            })}
                        ></textarea>
                        <button class="btn btn-outline btn-sm" onclick={on_batch_import}>
                            { "Import All" }
                        </button>
                    }
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <div>
                        <div class="card-title">{ "Download Tasks" }</div>
                        <div class="card-subtitle">{ format!("{} tasks total", tasks.len()) }</div>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick={fetch_tasks}>
                        { "🔄 Refresh" }
                    </button>
                </div>

                if *loading {
                    <div class="loading-container">
                        <div class="spinner"></div>
                    </div>
                } else if tasks.is_empty() {
                    <div class="empty-state">
                        <div class="empty-state-icon">{ "📥" }</div>
                        <div class="empty-state-text">{ "No download tasks" }</div>
                        <div class="empty-state-subtext">{ "Add an M3U8 URL above to start downloading" }</div>
                    </div>
                } else {
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>{ "ID" }</th>
                                    <th>{ "URL" }</th>
                                    <th>{ "Quality" }</th>
                                    <th>{ "Status" }</th>
                                    <th>{ "Progress" }</th>
                                    <th>{ "Actions" }</th>
                                </tr>
                            </thead>
                            <tbody>
                                { for tasks.iter().map(|task| {
                                    let id = task.id.clone();
                                    let id_display = if id.len() > 8 { format!("{}...", &id[..8]) } else { id.clone() };
                                    let url_display = if task.url.len() > 50 {
                                        format!("{}...", &task.url[..47])
                                    } else {
                                        task.url.clone()
                                    };
                                    let progress = task.progress.unwrap_or(0.0);
                                    let progress_pct = format!("{:.1}%", progress);
                                    let is_expanded = match &*expanded_task {
                                        Some(eid) => eid == &id,
                                        None => false,
                                    };

                                    let can_start = task.status == TaskStatus::Pending || task.status == TaskStatus::Paused;
                                    let can_pause = task.status == TaskStatus::Running;
                                    let can_cancel = task.status == TaskStatus::Running || task.status == TaskStatus::Paused;
                                    let can_delete = task.status == TaskStatus::Completed || task.status == TaskStatus::Failed || task.status == TaskStatus::Cancelled;
                                    let can_retry = task.status == TaskStatus::Failed;

                                    let on_start = {
                                        let on_action = on_action.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| on_action.emit((id.clone(), "start".to_string())))
                                    };
                                    let on_pause = {
                                        let on_action = on_action.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| on_action.emit((id.clone(), "pause".to_string())))
                                    };
                                    let on_cancel = {
                                        let on_action = on_action.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| on_action.emit((id.clone(), "cancel".to_string())))
                                    };
                                    let on_delete = {
                                        let on_action = on_action.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| on_action.emit((id.clone(), "delete".to_string())))
                                    };
                                    let on_retry = {
                                        let on_action = on_action.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| on_action.emit((id.clone(), "retry".to_string())))
                                    };
                                    let on_toggle = {
                                        let toggle_expand = toggle_expand.clone();
                                        let id = id.clone();
                                        Callback::from(move |_| toggle_expand.emit(id.clone()))
                                    };

                                    html! {
                                        <>
                                            <tr onclick={on_toggle} style="cursor: pointer;">
                                                <td style="font-family: monospace; color: var(--text-secondary);">
                                                    { id_display }
                                                </td>
                                                <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                    { url_display }
                                                </td>
                                                <td>
                                                    <span style="color: var(--text-secondary); font-size: 12px;">
                                                        { task.quality.as_deref().unwrap_or("auto") }
                                                    </span>
                                                </td>
                                                <td>
                                                    <span class={classes!("badge", task.status.css_class())}>
                                                        { task.status.as_str() }
                                                    </span>
                                                </td>
                                                <td>
                                                    <div style="display: flex; align-items: center; gap: 10px;">
                                                        <div class="progress-bar">
                                                            <div class="progress-bar-fill" style={format!("width: {}%", progress)}></div>
                                                        </div>
                                                        <span class="progress-text">{ progress_pct }</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div class="task-actions">
                                                        if can_start {
                                                            <button class="btn btn-success btn-sm" onclick={on_start}>
                                                                { "▶" }
                                                            </button>
                                                        }
                                                        if can_pause {
                                                            <button class="btn btn-warning btn-sm" onclick={on_pause}>
                                                                { "⏸" }
                                                            </button>
                                                        }
                                                        if can_cancel {
                                                            <button class="btn btn-danger btn-sm" onclick={on_cancel}>
                                                                { "⏹" }
                                                            </button>
                                                        }
                                                        if can_delete {
                                                            <button class="btn btn-ghost btn-sm" onclick={on_delete}>
                                                                { "🗑" }
                                                            </button>
                                                        }
                                                        if can_retry {
                                                            <button class="btn btn-outline btn-sm" onclick={on_retry}>
                                                                { "↻" }
                                                            </button>
                                                        }
                                                    </div>
                                                </td>
                                            </tr>
                                            if is_expanded {
                                                <tr>
                                                    <td colspan="6" style="padding: 0;">
                                                        <div class="task-detail-panel">
                                                            <div class="detail-row">
                                                                <span class="detail-label">{ "Task ID:" }</span>
                                                                <span class="detail-value">{ &task.id }</span>
                                                            </div>
                                                            <div class="detail-row">
                                                                <span class="detail-label">{ "URL:" }</span>
                                                                <span class="detail-value">{ &task.url }</span>
                                                            </div>
                                                            if let Some(fname) = &task.filename {
                                                                <div class="detail-row">
                                                                    <span class="detail-label">{ "Filename:" }</span>
                                                                    <span class="detail-value">{ fname }</span>
                                                                </div>
                                                            }
                                                            if let Some(q) = &task.quality {
                                                                <div class="detail-row">
                                                                    <span class="detail-label">{ "Quality:" }</span>
                                                                    <span class="detail-value">{ q }</span>
                                                                </div>
                                                            }
                                                            if let Some(speed) = &task.speed {
                                                                <div class="detail-row">
                                                                    <span class="detail-label">{ "Speed:" }</span>
                                                                    <span class="detail-value">{ speed }</span>
                                                                </div>
                                                            }
                                                            if let Some(err) = &task.error_message {
                                                                <div class="detail-row">
                                                                    <span class="detail-label">{ "Error:" }</span>
                                                                    <span class="detail-value" style="color: var(--danger);">{ err }</span>
                                                                </div>
                                                            }
                                                            if let Some(created) = &task.created_at {
                                                                <div class="detail-row">
                                                                    <span class="detail-label">{ "Created:" }</span>
                                                                    <span class="detail-value">{ created }</span>
                                                                </div>
                                                            }
                                                        </div>
                                                    </td>
                                                </tr>
                                            }
                                        </>
                                    }
                                }) }
                            </tbody>
                        </table>
                    </div>
                }
            </div>
        </div>
    }
}