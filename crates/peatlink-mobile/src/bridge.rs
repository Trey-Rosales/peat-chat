//! BLE ↔ WS bridge — connects peat-btle mesh messages to the local Hub
//! so BLE peers' messages appear in the WebView and vice versa.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, RwLock};

use crate::upstream_relay::SeenIds;
use crate::ws_server::{ChatMessage, Hub};

#[cfg(feature = "bluetooth")]
use crate::ble::{BleManager, BlePeerEvent};

/// Handle to shut down the bridge.
pub struct BridgeHandle {
    shutdown_tx: mpsc::Sender<()>,
}

impl BridgeHandle {
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(()).await;
    }
}

/// Start the BLE ↔ WS bridge. Spawns background tasks that:
/// 1. Poll BLE chat messages and inject into the local Hub
/// 2. Subscribe to Hub room broadcasts and send via BLE
/// 3. Forward BLE peer events as mesh_state updates
#[cfg(feature = "bluetooth")]
pub async fn start_bridge(
    hub: Arc<Hub>,
    ble_manager: Arc<BleManager>,
    ble_event_rx: mpsc::UnboundedReceiver<BlePeerEvent>,
    room_name: String,
    seen_ids: SeenIds,
    self_node_id: String,
) -> BridgeHandle {
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

    tokio::spawn(bridge_loop(
        hub,
        ble_manager,
        ble_event_rx,
        room_name,
        seen_ids,
        self_node_id,
        shutdown_rx,
    ));

    BridgeHandle { shutdown_tx }
}

#[cfg(feature = "bluetooth")]
async fn bridge_loop(
    hub: Arc<Hub>,
    ble_manager: Arc<BleManager>,
    mut ble_event_rx: mpsc::UnboundedReceiver<BlePeerEvent>,
    room_name: String,
    seen_ids: SeenIds,
    self_node_id: String,
    mut shutdown_rx: mpsc::Receiver<()>,
) {
    // Subscribe to local Hub room broadcasts (for WS → BLE direction)
    let mut room_rx = hub.subscribe_room(&room_name).await;

    // Track which BLE messages we've already processed (watermark by count)
    let mut last_ble_msg_count: usize = 0;

    // Poll interval for BLE chat messages
    let mut poll_interval = tokio::time::interval(Duration::from_secs(3));

    // Peer state broadcast interval
    let mut peer_interval = tokio::time::interval(Duration::from_secs(5));

    tracing::info!("BLE↔WS bridge started for room '{}'", room_name);

    loop {
        tokio::select! {
            // Poll BLE chat messages → inject into Hub
            _ = poll_interval.tick() => {
                let messages = ble_manager.chat_messages().await;
                if messages.len() > last_ble_msg_count {
                    let new_msgs = &messages[last_ble_msg_count..];
                    for (node_id, timestamp, sender_name, content, _reply_node, _reply_ts) in new_msgs {
                        // Generate a deterministic message ID from BLE fields
                        let msg_id = format!("ble-{}-{}", node_id, timestamp);

                        // Check dedup
                        let already_seen = {
                            let mut ids = seen_ids.write().await;
                            if ids.contains(&msg_id) {
                                true
                            } else {
                                ids.insert(msg_id.clone());
                                false
                            }
                        };

                        if !already_seen {
                            let chat_msg = ChatMessage {
                                id: msg_id,
                                sender: format!("ble-{}", node_id),
                                sender_name: sender_name.clone(),
                                timestamp: *timestamp,
                                content: content.clone(),
                                reply_to: None,
                            };

                            tracing::info!(
                                "BLE→WS: {} says '{}'",
                                sender_name,
                                &content[..content.len().min(50)]
                            );
                            hub.inject_external_message(&room_name, chat_msg).await;
                        }
                    }
                    last_ble_msg_count = messages.len();
                }
            }

            // Hub room broadcast → send via BLE
            Ok(broadcast) = room_rx.recv() => {
                if let Some((sender, content, timestamp)) = extract_chat_for_ble(&broadcast, &seen_ids).await {
                    tracing::info!(
                        "WS→BLE: {} says '{}'",
                        sender,
                        &content[..content.len().min(50)]
                    );
                    // send_chat returns the encrypted doc to broadcast; the tick loop handles actual transmission
                    let _ = ble_manager.send_chat(&sender, &content, timestamp).await;
                }
            }

            // BLE peer events → peer_update in Hub
            Some(event) = ble_event_rx.recv() => {
                match &event {
                    BlePeerEvent::PeerConnected(info) => {
                        tracing::info!("BLE peer connected: {} ({})", info.name, info.id);
                        broadcast_ble_peer_update(&hub, &room_name, info, "joined", &self_node_id).await;
                    }
                    BlePeerEvent::PeerDisconnected(info) => {
                        tracing::info!("BLE peer disconnected: {} ({})", info.name, info.id);
                        broadcast_ble_peer_update(&hub, &room_name, info, "left", &self_node_id).await;
                    }
                }
            }

            // Periodic BLE peer state → mesh_state
            _ = peer_interval.tick() => {
                broadcast_ble_mesh_state(&hub, &room_name, &ble_manager, &self_node_id).await;
            }

            // Shutdown
            _ = shutdown_rx.recv() => {
                tracing::info!("BLE↔WS bridge shutting down");
                return;
            }
        }
    }
}

/// Extract chat message fields from a Hub broadcast JSON for sending via BLE.
/// Returns (sender_name, content, timestamp) if it's a chat message we should forward.
async fn extract_chat_for_ble(
    broadcast: &str,
    seen_ids: &SeenIds,
) -> Option<(String, String, u64)> {
    let envelope: serde_json::Value = serde_json::from_str(broadcast).ok()?;
    let msg_type = envelope.get("type")?.as_str()?;

    if msg_type != "message" {
        return None;
    }

    let data = envelope.get("data")?;
    let msg = data.get("message")?;

    let msg_id = msg.get("id")?.as_str()?.to_string();

    // Dedup — don't send back messages that came from BLE
    {
        let ids = seen_ids.read().await;
        if ids.contains(&msg_id) {
            return None;
        }
    }

    let sender_name = msg.get("sender_name")?.as_str()?.to_string();
    let content = msg.get("content")?.as_str()?.to_string();
    let timestamp = msg.get("timestamp")?.as_u64()?;

    Some((sender_name, content, timestamp))
}

/// Broadcast a peer_update for a BLE peer event.
#[cfg(feature = "bluetooth")]
async fn broadcast_ble_peer_update(
    hub: &Arc<Hub>,
    room_name: &str,
    peer: &crate::ble::BlePeerInfo,
    event: &str,
    self_node_id: &str,
) {
    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    let room_id = crate::ws_server::chat_id_hex(&chat_id);

    let msg = crate::ws_server::make_json(
        "peer_update",
        &serde_json::json!({
            "room_id": room_id,
            "peer_id": peer.id,
            "name": peer.name,
            "event": event,
            "transport": "btle",
            "connected_via": self_node_id,
        }),
    );

    // Broadcast to room + downstream (so WebView sees it)
    let rooms = hub.rooms.read().await;
    for (id, room_arc) in rooms.iter() {
        if crate::ws_server::chat_id_hex(id) == room_id {
            let room = room_arc.read().await;
            let _ = room.tx.send(Arc::new(msg.clone()));
            break;
        }
    }
}

/// Broadcast BLE peers as mesh_state with connected_via field.
#[cfg(feature = "bluetooth")]
async fn broadcast_ble_mesh_state(
    hub: &Arc<Hub>,
    room_name: &str,
    ble_manager: &Arc<BleManager>,
    self_node_id: &str,
) {
    let peers = ble_manager.peers().await;
    if peers.is_empty() {
        return;
    }

    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    let room_id = crate::ws_server::chat_id_hex(&chat_id);

    let ble_peers: Vec<serde_json::Value> = peers
        .iter()
        .filter(|p| p.is_connected)
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "short_id": if p.id.len() >= 12 { &p.id[..12] } else { &p.id[..] },
                "transport": "btle",
                "latency_ms": 0,
                "state": "connected",
                "connected_at": crate::ws_server::now_ms() - p.last_seen_ms,
                "connected_via": self_node_id,
            })
        })
        .collect();

    if ble_peers.is_empty() {
        return;
    }

    // Send via downstream channel so WebView gets it directly
    let msg = crate::ws_server::make_json(
        "ble_mesh_state",
        &serde_json::json!({
            "room_id": room_id,
            "peers": ble_peers,
        }),
    );
    let _ = hub.downstream_tx.send(Arc::new(msg));
}
