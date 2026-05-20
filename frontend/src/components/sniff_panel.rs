use yew::prelude::*;
use crate::models::*;
use crate::api::ApiClient;

#[function_component]
pub fn SniffPanel() -> Html {
    let sniff_status = use_state(|| SniffStatus {
        active: false,
        target_url: None,
        results: Vec::new(),
    });
    let target_url = use_state(String::new);
    let loading = use_state(|| false);
    let debug_mode = use_state(|| false);
    let error = use_state(|| None::<String>);
    let toast = use_state(|| None::<(String, String)>);

    let fetch_status = {
        let sniff_status = sniff_status.clone();
        let error = error.clone();
        Callback::from(move |_| {
            let sniff_status = sniff_status.clone();
            let error = error.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::get_sniff_status().await {
                    Ok(s) => {
                        sniff_status.set(s);
                        error.set(None);
                    }
                    Err(e) => error.set(Some(e)),
                }
            });
        })
    };

    {
        let fetch = fetch_status.clone();
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

    let on_start = {
        let target_url = target_url.clone();
        let loading = loading.clone();
        let fetch_status = fetch_status.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let url = (*target_url).clone();
            if url.trim().is_empty() {
                show_toast.emit(("Please enter a target URL".to_string(), "warning".to_string()));
                return;
            }
            let loading = loading.clone();
            let fetch_status = fetch_status.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                match ApiClient::start_sniff(url.trim()).await {
                    Ok(_) => {
                        show_toast.emit(("Sniffing started".to_string(), "success".to_string()));
                        fetch_status.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to start sniffing: {}", e), "error".to_string()));
                    }
                }
                loading.set(false);
            });
        })
    };

    let on_stop = {
        let loading = loading.clone();
        let fetch_status = fetch_status.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let loading = loading.clone();
            let fetch_status = fetch_status.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                match ApiClient::stop_sniff().await {
                    Ok(_) => {
                        show_toast.emit(("Sniffing stopped".to_string(), "info".to_string()));
                        fetch_status.emit(());
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to stop sniffing: {}", e), "error".to_string()));
                    }
                }
                loading.set(false);
            });
        })
    };

    let on_add_to_downloads = {
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
                        show_toast.emit(("Added to download tasks".to_string(), "success".to_string()));
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to add: {}", e), "error".to_string()));
                    }
                }
            });
        })
    };

    html! {
        <div>
            <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: var(--text-primary);">
                { "Network Sniffer" }
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
                    <div class="card-title">{ "Sniff Control" }</div>
                </div>

                <div class="sniff-control">
                    <div class="form-group">
                        <label>{ "Target URL" }</label>
                        <input
                            type="text"
                            placeholder="https://example.com/video-page"
                            value={(*target_url).clone()}
                            disabled={sniff_status.active}
                            oninput={let u = target_url.clone(); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                u.set(input.value());
                            })}
                        />
                    </div>
                    if sniff_status.active {
                        <button class="btn btn-danger" onclick={on_stop} disabled={*loading}>
                            if *loading {
                                <span class="spinner spinner-sm"></span>
                            }
                            { "⏹ Stop Sniffing" }
                        </button>
                    } else {
                        <button class="btn btn-primary" onclick={on_start} disabled={*loading}>
                            if *loading {
                                <span class="spinner spinner-sm"></span>
                            }
                            { "🔍 Start Sniffing" }
                        </button>
                    }
                </div>

                <div class={classes!("sniff-status-banner", if sniff_status.active { "active" } else { "" })}>
                    <span class={classes!("status-dot", if sniff_status.active { "sniffing" } else { "disconnected" })}></span>
                    <span style="font-size: 13px; font-weight: 500;">
                        { if sniff_status.active {
                            format!("Sniffing in progress... Target: {}", sniff_status.target_url.as_deref().unwrap_or("N/A"))
                        } else {
                            "Sniffer is idle".to_string()
                        }}
                    </span>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <div>
                        <div class="card-title">{ "Detected M3U8 URLs" }</div>
                        <div class="card-subtitle">{ format!("{} streams found", sniff_status.results.len()) }</div>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick={fetch_status}>
                        { "🔄 Refresh" }
                    </button>
                </div>

                if sniff_status.results.is_empty() {
                    <div class="empty-state">
                        <div class="empty-state-icon">{ "🔍" }</div>
                        <div class="empty-state-text">{ "No streams detected yet" }</div>
                        <div class="empty-state-subtext">{ "Start sniffing to detect M3U8 streams on the target page" }</div>
                    </div>
                } else {
                    <div class="sniff-results-list">
                        { for sniff_status.results.iter().map(|result| {
                            let url = result.url.clone();
                            let on_add = {
                                let on_add_to_downloads = on_add_to_downloads.clone();
                                let url = url.clone();
                                Callback::from(move |_| on_add_to_downloads.emit(url.clone()))
                            };
                            let quality_display = result.quality.as_deref().unwrap_or("N/A");
                            let title_display = result.title.as_deref().unwrap_or("Untitled");

                            html! {
                                <div class="sniff-result-item">
                                    <div class="sniff-result-info">
                                        <div class="sniff-result-url">{ &result.url }</div>
                                        <div class="sniff-result-meta">
                                            { format!("{} | Quality: {}", title_display, quality_display) }
                                        </div>
                                    </div>
                                    <button class="btn btn-success btn-sm" onclick={on_add}>
                                        { "+ Add" }
                                    </button>
                                </div>
                            }
                        }) }
                    </div>
                }
            </div>

            <div class="debug-toggle">
                <div class="checkbox-group">
                    <input
                        type="checkbox"
                        id="debug-mode"
                        checked={*debug_mode}
                        onchange={let d = debug_mode.clone(); Callback::from(move |e: Event| {
                            let checkbox = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                            d.set(checkbox.checked());
                        })}
                    />
                    <label for="debug-mode">{ "Browser Debug Mode" }</label>
                </div>
                <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">
                    { "When enabled, the browser debugger console will be shown for advanced troubleshooting." }
                </p>
            </div>
        </div>
    }
}