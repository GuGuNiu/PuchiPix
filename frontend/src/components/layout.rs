use yew::prelude::*;
use yew_router::prelude::*;
use crate::app::Route;

#[derive(Properties, PartialEq)]
pub struct LayoutProps {
    pub children: Html,
}

#[function_component]
pub fn Layout(props: &LayoutProps) -> Html {
    let route = use_route::<Route>();

    let is_active = |r: &Route| -> String {
        if let Some(current) = &route {
            if current == r {
                return "nav-item active".to_string();
            }
        }
        "nav-item".to_string()
    };

    html! {
        <div class="app-layout">
            <aside class="sidebar">
                <div class="sidebar-header">
                    <div class="sidebar-logo">{ "PuchiPix" }</div>
                    <div class="sidebar-logo-sub">{ "M3U8 Downloader" }</div>
                </div>
                <nav class="sidebar-nav">
                    <Link<Route> to={Route::Dashboard} classes={classes!(is_active(&Route::Dashboard))}>
                        <span class="nav-item-icon">{ "📊" }</span>
                        <span class="nav-item-label">{ "Dashboard" }</span>
                    </Link<Route>>
                    <Link<Route> to={Route::Tasks} classes={classes!(is_active(&Route::Tasks))}>
                        <span class="nav-item-icon">{ "📥" }</span>
                        <span class="nav-item-label">{ "Tasks" }</span>
                    </Link<Route>>
                    <Link<Route> to={Route::Sniff} classes={classes!(is_active(&Route::Sniff))}>
                        <span class="nav-item-icon">{ "🔍" }</span>
                        <span class="nav-item-label">{ "Sniff" }</span>
                    </Link<Route>>
                    <Link<Route> to={Route::Config} classes={classes!(is_active(&Route::Config))}>
                        <span class="nav-item-icon">{ "⚙️" }</span>
                        <span class="nav-item-label">{ "Config" }</span>
                    </Link<Route>>
                    <Link<Route> to={Route::History} classes={classes!(is_active(&Route::History))}>
                        <span class="nav-item-icon">{ "📋" }</span>
                        <span class="nav-item-label">{ "History" }</span>
                    </Link<Route>>
                </nav>
            </aside>
            <div class="main-area">
                <StatusBar />
                <main class="content-area">
                    { props.children.clone() }
                </main>
            </div>
        </div>
    }
}

#[function_component]
fn StatusBar() -> Html {
    let connected = use_state(|| false);

    {
        let connected = connected.clone();
        use_effect_with_deps(move |_| {
            let connected = connected.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match crate::api::ApiClient::get_stats().await {
                    Ok(_) => connected.set(true),
                    Err(_) => connected.set(false),
                }
            });
            || {}
        }, ());
    }

    let status_class = if *connected { "status-dot connected" } else { "status-dot disconnected" };
    let status_text = if *connected { "Connected" } else { "Disconnected" };

    html! {
        <div class="status-bar">
            <div class="status-bar-left">
                <div class="status-indicator">
                    <span class={status_class}></span>
                    <span>{ status_text }</span>
                </div>
            </div>
            <div class="status-bar-right">
                <span style="color: var(--text-muted);">{ "v0.1.0" }</span>
            </div>
        </div>
    }
}