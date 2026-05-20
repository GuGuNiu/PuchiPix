use yew::prelude::*;
use crate::models::Config;
use crate::api::ApiClient;

#[function_component]
pub fn ConfigPanel() -> Html {
    let config = use_state(|| Config {
        chromedriver_path: None,
        ffmpeg_path: None,
        download_path: None,
        concurrency: Some(3),
        default_transcode: Some(false),
    });
    let loading = use_state(|| true);
    let saving = use_state(|| false);
    let error = use_state(|| None::<String>);
    let toast = use_state(|| None::<(String, String)>);

    {
        let config = config.clone();
        let loading = loading.clone();
        let error = error.clone();
        use_effect_with_deps(move |_| {
            let config = config.clone();
            let loading = loading.clone();
            let error = error.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match ApiClient::get_config().await {
                    Ok(c) => {
                        config.set(c);
                        error.set(None);
                    }
                    Err(e) => error.set(Some(e)),
                }
                loading.set(false);
            });
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

    let on_save = {
        let config = config.clone();
        let saving = saving.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let config = (*config).clone();
            let saving = saving.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                saving.set(true);
                match ApiClient::update_config(&config).await {
                    Ok(_) => {
                        show_toast.emit(("Configuration saved successfully".to_string(), "success".to_string()));
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to save config: {}", e), "error".to_string()));
                    }
                }
                saving.set(false);
            });
        })
    };

    let on_reset = {
        let config = config.clone();
        let loading = loading.clone();
        let show_toast = show_toast.clone();
        Callback::from(move |_| {
            let config = config.clone();
            let loading = loading.clone();
            let show_toast = show_toast.clone();
            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                match ApiClient::get_config().await {
                    Ok(c) => {
                        config.set(c);
                        show_toast.emit(("Config reset to server values".to_string(), "info".to_string()));
                    }
                    Err(e) => {
                        show_toast.emit((format!("Failed to reset config: {}", e), "error".to_string()));
                    }
                }
                loading.set(false);
            });
        })
    };

    let set_field = |field: &str| {
        let config = config.clone();
        Callback::from(move |value: String| {
            let mut new_config = (*config).clone();
            match field {
                "chromedriver_path" => new_config.chromedriver_path = Some(value),
                "ffmpeg_path" => new_config.ffmpeg_path = Some(value),
                "download_path" => new_config.download_path = Some(value),
                _ => {}
            }
            config.set(new_config);
        })
    };

    let set_concurrency = {
        let config = config.clone();
        Callback::from(move |value: String| {
            let mut new_config = (*config).clone();
            if let Ok(v) = value.parse::<u32>() {
                new_config.concurrency = Some(v);
            }
            config.set(new_config);
        })
    };

    let set_transcode = {
        let config = config.clone();
        Callback::from(move |checked: bool| {
            let mut new_config = (*config).clone();
            new_config.default_transcode = Some(checked);
            config.set(new_config);
        })
    };

    if *loading {
        return html! {
            <div>
                <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: var(--text-primary);">
                    { "Configuration" }
                </h2>
                <div class="loading-container">
                    <div class="spinner"></div>
                </div>
            </div>
        };
    }

    html! {
        <div>
            <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: var(--text-primary);">
                { "Configuration" }
            </h2>

            if let Some((msg, level)) = &*toast {
                <div class={classes!("toast", format!("toast-{}", level))}
                     style="position: static; margin-bottom: 16px; animation: none; max-width: none;">
                    { msg }
                </div>
            }

            if let Some(err) = &*error {
                <div class="error-message">{ format!("Error loading config: {}", err) }</div>
            }

            <div class="card">
                <div class="config-section">
                    <div class="config-section-title">{ "Paths" }</div>
                    <div class="form-group">
                        <label>{ "ChromeDriver Path" }</label>
                        <input
                            type="text"
                            placeholder="/usr/local/bin/chromedriver"
                            value={config.chromedriver_path.as_deref().unwrap_or("")}
                            oninput={let cb = set_field("chromedriver_path"); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                cb.emit(input.value());
                            })}
                        />
                    </div>
                    <div class="form-group">
                        <label>{ "FFmpeg Path" }</label>
                        <input
                            type="text"
                            placeholder="/usr/local/bin/ffmpeg"
                            value={config.ffmpeg_path.as_deref().unwrap_or("")}
                            oninput={let cb = set_field("ffmpeg_path"); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                cb.emit(input.value());
                            })}
                        />
                    </div>
                    <div class="form-group">
                        <label>{ "Default Download Path" }</label>
                        <input
                            type="text"
                            placeholder="/downloads"
                            value={config.download_path.as_deref().unwrap_or("")}
                            oninput={let cb = set_field("download_path"); Callback::from(move |e: InputEvent| {
                                let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                cb.emit(input.value());
                            })}
                        />
                    </div>
                </div>

                <div class="config-section">
                    <div class="config-section-title">{ "Download Settings" }</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>{ "Concurrency" }</label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={config.concurrency.map(|v| v.to_string()).unwrap_or_else(|| "3".to_string())}
                                oninput={let cb = set_concurrency.clone(); Callback::from(move |e: InputEvent| {
                                    let input = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                    cb.emit(input.value());
                                })}
                            />
                        </div>
                        <div class="form-group" style="flex: 0; min-width: 200px;">
                            <div class="checkbox-group" style="padding-top: 24px;">
                                <input
                                    type="checkbox"
                                    id="default-transcode"
                                    checked={config.default_transcode.unwrap_or(false)}
                                    onchange={let cb = set_transcode.clone(); Callback::from(move |e: Event| {
                                        let checkbox = e.target_unchecked_into::<web_sys::HtmlInputElement>();
                                        cb.emit(checkbox.checked());
                                    })}
                                />
                                <label for="default-transcode">{ "Default MP4 Transcode" }</label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="config-actions">
                    <button class="btn btn-primary" onclick={on_save} disabled={*saving}>
                        if *saving {
                            <span class="spinner spinner-sm"></span>
                        }
                        { "💾 Save Configuration" }
                    </button>
                    <button class="btn btn-ghost" onclick={on_reset}>
                        { "↻ Reset" }
                    </button>
                </div>
            </div>
        </div>
    }
}