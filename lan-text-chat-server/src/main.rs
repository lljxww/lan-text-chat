mod models;
mod state;
mod util;
mod ws;

use axum::routing::get;
use axum::Router;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::state::AppState;
use crate::ws::ws_handler;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listen_addr = env::args()
        .nth(1)
        .unwrap_or_else(|| "0.0.0.0:38991".to_string());
    let addr: SocketAddr = listen_addr.parse()?;
    let state = Arc::new(RwLock::new(AppState::default()));
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("LAN Text Chat WebSocket server listening on ws://{addr}/ws");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
