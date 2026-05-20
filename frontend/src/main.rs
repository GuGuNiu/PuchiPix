mod app;
mod api;
mod components;
mod models;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn main() -> Result<(), JsValue> {
    wasm_logger::init(wasm_logger::Config::default());
    yew::Renderer::<app::App>::new().render();
    Ok(())
}