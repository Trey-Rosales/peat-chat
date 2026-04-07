//! BLE ↔ WS bridge — connects peat-btle mesh messages to the local Hub
//! so BLE peers' messages appear in the WebView and vice versa.
//!
//! Uses peat-btle's chat channel as a transport for all WS message types.
//! Messages prefixed with `__ws:` carry full JSON envelopes (DMs, reactions,
//! edits, pins, CoT, etc.). Unprefixed messages are plain text chat.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;

use crate::upstream_relay::SeenIds;
use crate::ws_server::{ChatMessage, Hub};

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

#[cfg(feature = "bluetooth")]
use crate::ble::{BleManager, BlePeerEvent};

const WS_PREFIX: &str = "__ws:";

/// Handle to shut down the bridge.
pub struct BridgeHandle {
    shutdown_tx: mpsc::Sender<()>,
}

impl BridgeHandle {
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(()).await;
    }
}

#[cfg(feature = "bluetooth")]
pub async fn start_bridge(
    hub: Arc<Hub>,
    ble_manager: Arc<BleManager>,
    ble_event_rx: mpsc::UnboundedReceiver<BlePeerEvent>,
    room_name: String,
    seen_ids: SeenIds,
    self_node_id: String,
    voice_outgoing_rx: mpsc::UnboundedReceiver<crate::VoiceFrame>,
    voice_incoming_tx: mpsc::UnboundedSender<crate::VoiceFrame>,
) -> BridgeHandle {
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

    tokio::spawn(bridge_loop(
        hub, ble_manager, ble_event_rx, room_name, seen_ids, self_node_id, shutdown_rx,
        voice_outgoing_rx, voice_incoming_tx,
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
    mut voice_outgoing_rx: mpsc::UnboundedReceiver<crate::VoiceFrame>,
    voice_incoming_tx: mpsc::UnboundedSender<crate::VoiceFrame>,
) {
    // Subscribe to local Hub room broadcasts (WS → BLE direction)
    let mut room_rx = hub.subscribe_room(&room_name).await;

    // Also subscribe to downstream (catches DMs, reactions, etc. from upstream relay)
    let mut downstream_rx = hub.downstream_tx.subscribe();

    // Also subscribe to passthrough (catches user-initiated actions: start_dm, CoT, etc.)
    let mut passthrough_rx = hub.passthrough_tx.subscribe();

    // Track BLE message watermark
    let mut last_ble_msg_count: usize = 0;

    let mut poll_interval = tokio::time::interval(Duration::from_secs(3));
    let mut peer_interval = tokio::time::interval(Duration::from_secs(5));

    tracing::info!("BLE↔WS bridge started for room '{}'", room_name);

    loop {
        tokio::select! {
            // === BLE → WS: Poll BLE messages and inject into Hub ===
            _ = poll_interval.tick() => {
                let messages = ble_manager.chat_messages().await;
                if messages.len() > last_ble_msg_count {
                    let new_msgs = &messages[last_ble_msg_count..];
                    for (_node_id, timestamp, sender_name, content, _reply_node, _reply_ts) in new_msgs {
                        if content.starts_with(WS_PREFIX) {
                            // Full WS envelope — inject into Hub or forward to WebView
                            let json = &content[WS_PREFIX.len()..];
                            handle_ble_ws_message(json, &hub, &room_name, &seen_ids, &voice_incoming_tx).await;
                        } else {
                            // Plain text chat — create ChatMessage and inject into Hub
                            let msg_id = format!("ble-{}-{}", _node_id, timestamp);
                            let already_seen = {
                                let mut ids = seen_ids.write().await;
                                if ids.contains(&msg_id) { true }
                                else { ids.insert(msg_id.clone()); false }
                            };
                            if !already_seen {
                                let chat_msg = ChatMessage {
                                    id: msg_id,
                                    sender: format!("ble-{}", _node_id),
                                    sender_name: sender_name.clone(),
                                    timestamp: *timestamp,
                                    content: content.clone(),
                                    reply_to: None,
                                };
                                hub.inject_external_message(&room_name, chat_msg).await;
                            }
                        }
                    }
                    last_ble_msg_count = messages.len();
                }
            }

            // === WS → BLE: Hub room broadcasts (chat messages in "general") ===
            Ok(broadcast) = room_rx.recv() => {
                forward_ws_to_ble(&broadcast, &ble_manager, &seen_ids, &self_node_id).await;
            }

            // === WS → BLE: Downstream messages (DMs, peer_updates from upstream) ===
            Ok(downstream) = downstream_rx.recv() => {
                forward_ws_to_ble(&downstream, &ble_manager, &seen_ids, &self_node_id).await;
            }

            // === WS → BLE: Passthrough messages (user actions: start_dm, CoT, voice, etc.) ===
            Ok(passthrough) = passthrough_rx.recv() => {
                forward_ws_to_ble(&passthrough, &ble_manager, &seen_ids, &self_node_id).await;
            }

            // === BLE peer events → peer_update in Hub ===
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

            // === Voice: outgoing audio frames → BLE ===
            Some(frame) = voice_outgoing_rx.recv() => {
                let voice_json = serde_json::json!({
                    "type": "voice_audio",
                    "data": {
                        "sender_id": frame.sender_id,
                        "sender_name": frame.sender_name,
                        "timestamp": frame.timestamp,
                        "audio": base64_encode(&frame.data),
                    }
                });
                let payload = format!("{}{}", WS_PREFIX, voice_json);
                let now = crate::ws_server::now_ms();
                let _ = ble_manager.send_chat(&self_node_id, &payload, now).await;
            }

            // === Periodic BLE peer state → mesh_state ===
            _ = peer_interval.tick() => {
                broadcast_ble_mesh_state(&hub, &room_name, &ble_manager, &self_node_id).await;
            }

            _ = shutdown_rx.recv() => {
                tracing::info!("BLE↔WS bridge shutting down");
                return;
            }
        }
    }
}

/// Handle a WS JSON envelope received via BLE.
/// Parse it and route to the appropriate destination (Hub room or downstream).
async fn handle_ble_ws_message(
    json: &str,
    hub: &Arc<Hub>,
    room_name: &str,
    seen_ids: &SeenIds,
    voice_incoming_tx: &mpsc::UnboundedSender<crate::VoiceFrame>,
) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(json) else {
        return;
    };

    let msg_type = envelope
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match msg_type {
        // Chat messages — dedup and inject into the correct room
        "message" => {
            if let Some(data) = envelope.get("data") {
                if let Some(msg_val) = data.get("message") {
                    let msg_id = msg_val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if msg_id.is_empty() {
                        return;
                    }

                    let mut ids = seen_ids.write().await;
                    if ids.contains(&msg_id) {
                        return;
                    }
                    ids.insert(msg_id);
                    drop(ids);

                    // Check if room exists locally
                    let room_id = data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
                    if hub.find_room_by_hex(room_id).await.is_some() {
                        if let Ok(chat_msg) =
                            serde_json::from_value::<ChatMessage>(msg_val.clone())
                        {
                            hub.inject_external_message(room_name, chat_msg).await;
                        }
                    } else {
                        // DM or other room — send via downstream
                        let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
                    }
                }
            }
        }

        // Voice audio frames — decode and push to incoming queue for Kotlin playback
        "voice_audio" => {
            if let Some(data) = envelope.get("data") {
                let audio_b64 = data.get("audio").and_then(|v| v.as_str()).unwrap_or("");
                let sender_id = data.get("sender_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sender_name = data.get("sender_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let timestamp = data.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);

                if let Some(audio_data) = base64_decode(audio_b64) {
                    let frame = crate::VoiceFrame {
                        data: audio_data,
                        sender_id,
                        sender_name,
                        timestamp,
                    };
                    let _ = voice_incoming_tx.send(frame);
                }
            }
        }

        // DM, voice, CoT, reactions, edits, pins — forward to downstream for WebView
        "dm_opened" | "room_joined" | "room_history" | "peer_update" | "mesh_state"
        | "message_edited" | "message_deleted" | "reaction_updated"
        | "message_pinned" | "message_unpinned"
        | "voice_state" | "voice_channel_created" | "voice_peer_joined"
        | "voice_peer_left" | "voice_offer_relay" | "voice_answer_relay"
        | "voice_ice_relay" | "voice_speaking_broadcast"
        | "cot_state" | "marker_created" | "marker_deleted" => {
            let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
        }

        // User-initiated actions from remote BLE peer — forward to passthrough
        // so the upstream relay sends them to the Go server
        "send_message" | "start_dm" | "join_dm" | "join_room" | "set_name"
        | "edit_message" | "delete_message" | "add_reaction" | "remove_reaction"
        | "pin_message" | "unpin_message"
        | "join_voice" | "leave_voice" | "voice_offer" | "voice_answer" | "voice_ice"
        | "cot_position" | "create_marker" | "delete_marker" => {
            let _ = hub.passthrough_tx.send(Arc::new(json.to_string()));
        }

        _ => {
            // Unknown type — forward via downstream as best effort
            let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
        }
    }
}

/// Forward a WS message to BLE mesh.
/// Serializes the full JSON envelope with `__ws:` prefix via send_chat().
#[cfg(feature = "bluetooth")]
async fn forward_ws_to_ble(
    broadcast: &str,
    ble_manager: &Arc<BleManager>,
    seen_ids: &SeenIds,
    self_node_id: &str,
) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(broadcast) else {
        return;
    };

    let msg_type = envelope
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Skip types that shouldn't be forwarded to BLE peers
    // (mesh_state and peer_update are generated locally for BLE peers)
    match msg_type {
        "mesh_state" | "ble_mesh_state" | "identity" => return,
        _ => {}
    }

    // For chat messages, check dedup
    if msg_type == "message" {
        if let Some(data) = envelope.get("data") {
            if let Some(msg) = data.get("message") {
                let msg_id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if !msg_id.is_empty() {
                    let ids = seen_ids.read().await;
                    if ids.contains(msg_id) {
                        return; // Already seen (came from BLE or already forwarded)
                    }
                }
            }
        }
    }

    // Send the full JSON as a chat message with __ws: prefix
    let payload = format!("{}{}", WS_PREFIX, broadcast);
    let now = crate::ws_server::now_ms();
    let _ = ble_manager.send_chat(self_node_id, &payload, now).await;
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

    let msg = crate::ws_server::make_json(
        "ble_mesh_state",
        &serde_json::json!({
            "room_id": room_id,
            "peers": ble_peers,
        }),
    );
    let _ = hub.downstream_tx.send(Arc::new(msg));
}
