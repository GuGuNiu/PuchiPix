use yew::prelude::*;
use yew_router::prelude::*;
use crate::components::*;

#[derive(Clone, PartialEq, Routable)]
pub enum Route {
    #[at("/")]
    Dashboard,
    #[at("/tasks")]
    Tasks,
    #[at("/sniff")]
    Sniff,
    #[at("/config")]
    Config,
    #[at("/history")]
    History,
}

fn switch(route: Route) -> Html {
    match route {
        Route::Dashboard => html! { <Layout><Dashboard /></Layout> },
        Route::Tasks => html! { <Layout><TaskList /></Layout> },
        Route::Sniff => html! { <Layout><SniffPanel /></Layout> },
        Route::Config => html! { <Layout><ConfigPanel /></Layout> },
        Route::History => html! { <Layout><History /></Layout> },
    }
}

#[function_component]
pub fn App() -> Html {
    html! {
        <BrowserRouter>
            <Switch<Route> render={switch} />
        </BrowserRouter>
    }
}