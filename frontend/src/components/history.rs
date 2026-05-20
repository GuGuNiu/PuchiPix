use yew::prelude::*;
use crate::models::*;
use crate::api::ApiClient;

#[function_component]
pub fn History() -> Html {
    let items = use_state(|| Vec::<HistoryItem>::new());
    let loading = use_state(|| true);
    let error = use_state(|| None::<String>);
    let search_query = use_state(String::new);
    let total = use_state(|| 0u32);
    let toast = use_state(|| None::<(String, String)>);

    let fetch_history = {
        let items = items.clone();
        let loading = loading.clone();
        let error = error.clone();
        let total = total.clone();
        let search_query = search_query.clone();
        Callback::from(move |_| {
            let items = items.clone();
            let loading = loading.clone();
            let error = error.clone();
            let total = total.clone();
            let query = (*search_query).clone();
            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                let q = if query.trim().is_empty() { None } else { Some(query.trim()) };
                match ApiClient::get_history(None, q).await {
                    Ok(resp) => {
                        items.set(resp.items);
                        total.set(resp.total);
                        error.set(None);
                    }
                    Err(e) => error.set(Some(e)),
                }
                loading.set(false);
            });
        })
    };

    {
        let fetch = fetch_history.clone();
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

    let on_search = {
        let fetch_history = fetch_history.clone();
        Callback::from(move |_| {
            fetch_history.emit(());
        })
    };

    let on_clear = {
        let fetch_history = fetch_history.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let fetch_history = fetch_history.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::clear_history().await {
                    Ok(_) => {
                        show_toast.emit(("History cleared".to_string(), "success".to_string()));
                        fetch_history.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to clear history: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    let on_redownload = {
        let show_toast = show_toast.clone();
        Callback::from(move |url: String| {
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::create_task(&TaskCreateRequest {
                    url,
                    quality: Some("best".to_string()),
                    transcode_to_mp4: Some(false),
                }).await {
                    Ok(_) => {
                        show_toast.emit(("Task re-created for download".to_string(), "success".to_string()));
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to re-download: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    let on_keydown = {
        let on_search = on_search.clone();
        Callback::from(move |e: KeyboardEvent| {
            if e.key() == "Enter" {
                on_search.emit(());
            }
        })
    };

    html! {
        <div>
            <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: var(--text-primary);">
                { "Download History" }
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

            <div class="card">
                <div class="card-header">
                    <div>
                        <div class="card-title">{ "History Records" }</div>
                        <div class="card-subtitle">{ format!("{} total entries", *total) }</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-ghost btn-sm" onclick={fetch_history}>
                            { "🔄 Refresh" }
                        </button>
                        <button class="btn btn-danger btn-sm" onclick={on_clear}>
                            { "🗑 Clear" }
                        </button>
                    </div>
                </div>

                <div class="history-toolbar">
                    <div class="form-group">
                        <input
                            type="text"
                            placeholder="Search by URL or filename..."
                            value={(*search_query).clone()}
                            oninput={let s = search_query.clone(); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                s.set(input.value());
                            })}
                            onkeydown={on_keydown}
                        />
                    </div>
                    <button class="btn btn-primary" onclick={on_search}>
                        { "🔍 Search" }
                    </button>
                </div>

                if *loading {
                    <div class="loading-container">
                        <div class="spinner"></div>
                    </div>
                } else if items.is_empty() {
                    <div class="empty-state">
                        <div class="empty-state-icon">{ "📋" }</div>
                        <div class="empty-state-text">{ "No history found" }</div>
                        <div class="empty-state-subtext">
                            { if search_query.is_empty() {
                                "Completed downloads will appear here"
                            } else {
                                "No results match your search query"
                            }}
                        </div>
                    </div>
                } else {
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>{ "ID" }</th>
                                    <th>{ "URL" }</th>
                                    <th>{ "Filename" }</th>
                                    <th>{ "Status" }</th>
                                    <th>{ "Completed At" }</th>
                                    <th>{ "Actions" }</th>
                                </tr>
                            </thead>
                            <tbody>
                                { for items.iter().map(|item| {
                                    let id_display = if item.id.len() > 8 { format!("{}...", &item.id[..8]) } else { item.id.clone() };
                                    let url_display = if item.url.len() > 40 {
                                        format!("{}...", &item.url[..37])
                                    } else {
                                        item.url.clone()
                                    };
                                    let url = item.url.clone();
                                    let on_redownload = {
                                        let on_redownload = on_redownload.clone();
                                        let url = url.clone();
                                        Callback::from(move |_| on_redownload.emit(url.clone()))
                                    };

                                    html! {
                                        <tr>
                                            <td style="font-family: monospace; color: var(--text-secondary);">
                                                { id_display }
                                            </td>
                                            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                                                title={&item.url}>
                                                { url_display }
                                            </td>
                                            <td>
                                                { item.filename.as_deref().unwrap_or("N/A") }
                                            </td>
                                            <td>
                                                <span class="badge badge-completed" style="font-size: 11px;">
                                                    { item.status.as_deref().unwrap_or("completed") }
                                                </span>
                                            </td>
                                            <td style="color: var(--text-secondary); font-size: 12px;">
                                                { item.completed_at.as_deref().unwrap_or("N/A") }
                                            </td>
                                            <td>
                                                <button class="btn btn-outline btn-sm" onclick={on_redownload}>
                                                    { "↻ Re-download" }
                                                </button>
                                            </td>
                                        </tr>
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