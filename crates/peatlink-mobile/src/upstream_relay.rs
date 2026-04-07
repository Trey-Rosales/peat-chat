//! Upstream WS relay — connects to a remote Go server and acts as a
//! transparent bidirectional proxy between the local embedded Hub and
//! the remote server.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;

use crate::ws_server::Hub;

/// Handle returned from `start_upstream_relay` to control the relay lifecycle.
pub struct UpstreamRelayHandle {
    shutdown_tx: mpsc::Sender<()>,
    connected: Arc<RwLock<bool>>,
}

impl UpstreamRelayHandle {
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(()).await;
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }
}

/// Shared dedup set for message IDs.
pub type SeenIds = Arc<RwLock<HashSet<String>>>;

pub fn new_seen_ids() -> SeenIds {
    Arc::new(RwLock::new(HashSet::new()))
}

pub async fn start_upstream_relay(
    url: String,
    hub: Arc<Hub>,
    display_name: String,
    room_name: String,
    seen_ids: SeenIds,
) -> Result<UpstreamRelayHandle, String> {
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
    let connected = Arc::new(RwLock::new(false));

    let handle = UpstreamRelayHandle {
        shutdown_tx,
        connected: connected.clone(),
    };

    tokio::spawn(relay_loop(
        url, hub, display_name, room_name, seen_ids, connected, shutdown_rx,
    ));

    Ok(handle)
}

async fn relay_loop(
    url: String,
    hub: Arc<Hub>,
    display_name: String,
    room_name: String,
    seen_ids: SeenIds,
    connected: Arc<RwLock<bool>>,
    mut shutdown_rx: mpsc::Receiver<()>,
) {
    let mut backoff = Duration::from_secs(2);
    let max_backoff = Duration::from_secs(30);

    loop {
        tracing::info!(url = %url, "upstream relay connecting...");

        match tokio_tungstenite::connect_async(&url).await {
            Ok((ws_stream, _)) => {
                *connected.write().await = true;
                backoff = Duration::from_secs(2);
                tracing::info!("upstream relay connected");

                let result = run_relay(
                    ws_stream, &hub, &display_name, &room_name, &seen_ids, &mut shutdown_rx,
                ).await;

                *connected.write().await = false;

                if result.is_shutdown() {
                    tracing::info!("upstream relay shut down");
                    return;
                }
                tracing::warn!("upstream relay disconnected, reconnecting in {:?}", backoff);
            }
            Err(e) => {
                tracing::warn!("upstream relay connection failed: {}, retrying in {:?}", e, backoff);
            }
        }

        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = shutdown_rx.recv() => {
                tracing::info!("upstream relay shut down during backoff");
                return;
            }
        }

        backoff = (backoff * 2).min(max_backoff);
    }
}

enum RelayResult {
    Disconnected,
    Shutdown,
}

impl RelayResult {
    fn is_shutdown(&self) -> bool {
        matches!(self, RelayResult::Shutdown)
    }
}

async fn run_relay(
    ws_stream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    hub: &Arc<Hub>,
    display_name: &str,
    room_name: &str,
    seen_ids: &SeenIds,
    shutdown_rx: &mut mpsc::Receiver<()>,
) -> RelayResult {
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Our identity on the upstream server (set by their `identity` message)
    let upstream_self_id: Arc<RwLock<String>> = Arc::new(RwLock::new(String::new()));

    // Send set_name
    let set_name = serde_json::json!({
        "type": "set_name",
        "data": { "name": display_name }
    });
    if ws_tx.send(Message::Text(set_name.to_string())).await.is_err() {
        return RelayResult::Disconnected;
    }

    // Send join_room
    let join = serde_json::json!({
        "type": "join_room",
        "data": { "name": room_name }
    });
    if ws_tx.send(Message::Text(join.to_string())).await.is_err() {
        return RelayResult::Disconnected;
    }

    // Subscribe to local hub broadcasts for this room
    let mut local_rx = hub.subscribe_room(room_name).await;

    // Subscribe to passthrough channel (DMs, voice, CoT, etc. from WebView)
    let mut passthrough_rx = hub.passthrough_tx.subscribe();

    // Periodic seen_ids cleanup
    let mut cleanup_interval = tokio::time::interval(Duration::from_secs(60));

    loop {
        tokio::select! {
            // Incoming from upstream Go server → forward to local Hub
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_upstream_message(
                            &text, hub, room_name, seen_ids, &upstream_self_id
                        ).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return RelayResult::Disconnected;
                    }
                    _ => {}
                }
            }

            // Outgoing from local Hub room → forward to upstream
            Ok(broadcast) = local_rx.recv() => {
                if let Some(fwd) = filter_for_upstream(
                    &broadcast, seen_ids, &upstream_self_id
                ).await {
                    if ws_tx.send(Message::Text(fwd)).await.is_err() {
                        return RelayResult::Disconnected;
                    }
                }
            }

            // Passthrough: unrecognized messages from WebView → forward to upstream as-is
            Ok(passthrough) = passthrough_rx.recv() => {
                tracing::debug!("passthrough → upstream: {}", &passthrough[..80.min(passthrough.len())]);
                if ws_tx.send(Message::Text((*passthrough).clone())).await.is_err() {
                    return RelayResult::Disconnected;
                }
            }

            _ = shutdown_rx.recv() => {
                let _ = ws_tx.send(Message::Close(None)).await;
                return RelayResult::Shutdown;
            }

            _ = cleanup_interval.tick() => {
                let mut ids = seen_ids.write().await;
                if ids.len() > 10000 {
                    ids.clear();
                }
            }
        }
    }
}

/// Handle a message from upstream. Forward to local Hub clients.
async fn handle_upstream_message(
    text: &str,
    hub: &Arc<Hub>,
    room_name: &str,
    seen_ids: &SeenIds,
    upstream_self_id: &Arc<RwLock<String>>,
) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    let msg_type = envelope.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        // Capture our upstream identity so we can filter echoes
        "identity" => {
            if let Some(data) = envelope.get("data") {
                if let Some(id) = data.get("id").and_then(|v| v.as_str()) {
                    *upstream_self_id.write().await = id.to_string();
                    tracing::info!("upstream relay identity: {}", id);
                }
            }
        }

        // Chat messages — dedup, then route to correct room or downstream
        "message" => {
            let Some(data) = envelope.get("data") else { return };
            let Some(msg_val) = data.get("message") else { return };

            let msg_id = msg_val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if msg_id.is_empty() { return; }

            {
                let mut ids = seen_ids.write().await;
                if ids.contains(&msg_id) { return; }
                ids.insert(msg_id);
            }

            // Check if this message's room_id matches a local Hub room
            let msg_room_id = data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let local_room_exists = hub.find_room_by_hex(msg_room_id).await.is_some();

            if local_room_exists {
                // Regular room (e.g., "general") — only inject messages from OTHER users
                // (our own messages are already in the local Hub from the local send)
                let sender = msg_val.get("sender").and_then(|v| v.as_str()).unwrap_or("");
                let self_id = upstream_self_id.read().await;
                if !self_id.is_empty() && sender == self_id.as_str() {
                    return; // echo of our own message in a local room
                }

                if let Ok(chat_msg) = serde_json::from_value::<crate::ws_server::ChatMessage>(msg_val.clone()) {
                    hub.inject_external_message(room_name, chat_msg).await;
                }
            } else {
                // DM or other upstream-only room — forward ALL messages to WebView
                // including our own (the WebView needs to see them since the local Hub
                // didn't handle this room)
                let _ = hub.downstream_tx.send(Arc::new(text.to_string()));
            }
        }

        // Room history — check if it's for a local room or a DM room
        "room_history" => {
            let Some(data) = envelope.get("data") else { return };
            let history_room_id = data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let local_room_exists = hub.find_room_by_hex(history_room_id).await.is_some();

            if local_room_exists {
                // Local room — inject individual messages
                let self_id = upstream_self_id.read().await;
                if let Some(messages) = data.get("messages").and_then(|v| v.as_array()) {
                    for msg_val in messages {
                        let sender = msg_val.get("sender").and_then(|v| v.as_str()).unwrap_or("");
                        if !self_id.is_empty() && sender == self_id.as_str() {
                            continue;
                        }
                        let msg_id = msg_val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if msg_id.is_empty() { continue; }
                        let mut ids = seen_ids.write().await;
                        if ids.contains(&msg_id) { continue; }
                        ids.insert(msg_id.clone());
                        drop(ids);

                        if let Ok(chat_msg) = serde_json::from_value::<crate::ws_server::ChatMessage>(msg_val.clone()) {
                            hub.inject_external_message(room_name, chat_msg).await;
                        }
                    }
                }
            } else {
                // DM room history — forward directly to WebView
                let _ = hub.downstream_tx.send(Arc::new(text.to_string()));
            }
        }

        // Peer/mesh state — send via downstream channel directly to WebView
        // so upstream member counts aren't overridden by local Hub's own mesh_state
        "peer_update" | "mesh_state" | "room_joined" | "dm_opened" => {
            let _ = hub.downstream_tx.send(Arc::new(text.to_string()));
        }

        // All other message types (voice, CoT, etc.)
        // Try room-scoped broadcast first, fall back to downstream
        _ => {
            broadcast_raw_to_local(hub, text).await;
        }
    }
}

/// Forward a raw JSON message from upstream to local clients.
/// If the message has a room_id, broadcast to that room's subscribers.
/// Otherwise, send via the downstream channel directly to all WebView clients.
async fn broadcast_raw_to_local(hub: &Arc<Hub>, text: &str) {
    let mut sent_to_room = false;

    if let Ok(envelope) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(data) = envelope.get("data") {
            if let Some(room_id_str) = data.get("room_id").and_then(|v| v.as_str()) {
                let rooms = hub.rooms.read().await;
                for (id, room_arc) in rooms.iter() {
                    let full_id = crate::ws_server::chat_id_hex(id);
                    if full_id == room_id_str || full_id.starts_with(room_id_str) {
                        let room = room_arc.read().await;
                        let _ = room.tx.send(Arc::new(text.to_string()));
                        sent_to_room = true;
                        break;
                    }
                }
            }
        }
    }

    // If not sent to a specific room, send via downstream channel
    // This handles DM responses, identity messages, etc.
    if !sent_to_room {
        let _ = hub.downstream_tx.send(Arc::new(text.to_string()));
    }
}

/// Filter a local Hub broadcast for forwarding upstream.
/// Only forward user-originated actions, not server broadcasts.
async fn filter_for_upstream(
    broadcast: &str,
    seen_ids: &SeenIds,
    upstream_self_id: &Arc<RwLock<String>>,
) -> Option<String> {
    let envelope: serde_json::Value = serde_json::from_str(broadcast).ok()?;
    let msg_type = envelope.get("type")?.as_str()?;

    match msg_type {
        // Chat messages — forward as send_message
        "message" => {
            let data = envelope.get("data")?;
            let msg = data.get("message")?;
            let msg_id = msg.get("id")?.as_str()?.to_string();

            // Dedup check
            {
                let mut ids = seen_ids.write().await;
                if ids.contains(&msg_id) { return None; }
                ids.insert(msg_id);
            }

            let room_id = data.get("room_id")?.as_str()?;
            let content = msg.get("content")?.as_str()?;
            let reply_to = msg.get("reply_to").and_then(|v| v.as_str());

            let mut send = serde_json::json!({
                "type": "send_message",
                "data": {
                    "room_id": room_id,
                    "content": content,
                }
            });
            if let Some(rt) = reply_to {
                send["data"]["reply_to"] = serde_json::Value::String(rt.to_string());
            }
            Some(send.to_string())
        }

        // Forward CoT position updates
        "cot_position" => Some(broadcast.to_string()),

        // Forward marker operations
        "create_marker" | "delete_marker" => Some(broadcast.to_string()),

        // Forward voice operations
        "join_voice" | "leave_voice" | "voice_offer" | "voice_answer"
        | "voice_ice" | "voice_speaking" | "create_voice_channel" => {
            Some(broadcast.to_string())
        }

        // Don't forward server-generated broadcasts back upstream
        // (peer_update, mesh_state, room_joined, room_history, identity, etc.)
        _ => None,
    }
}
