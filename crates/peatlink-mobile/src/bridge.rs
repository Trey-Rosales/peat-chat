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

/// Fast content hash for dedup (not cryptographic, just loop prevention).
fn fxhash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

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
    ble_recv_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    ble_send_tx: mpsc::UnboundedSender<Vec<u8>>,
) -> BridgeHandle {
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

    tokio::spawn(bridge_loop(
        hub, ble_manager, ble_event_rx, room_name, seen_ids, self_node_id, shutdown_rx,
        voice_outgoing_rx, voice_incoming_tx, ble_recv_rx, ble_send_tx,
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
    mut ble_recv_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    ble_send_tx: mpsc::UnboundedSender<Vec<u8>>,
) {
    // Subscribe to local Hub room broadcasts (WS → BLE direction)
    let mut room_rx = hub.subscribe_room(&room_name).await;

    // Also subscribe to downstream (catches DMs, reactions, etc. from upstream relay)
    let mut downstream_rx = hub.downstream_tx.subscribe();

    // Also subscribe to passthrough (catches user-initiated actions: start_dm, CoT, etc.)
    let mut passthrough_rx = hub.passthrough_tx.subscribe();

    let mut peer_interval = tokio::time::interval(Duration::from_secs(5));

    // Track BLE peers locally (since peat-btle's peer list may be empty)
    let mut ble_peer_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    tracing::info!("BLE↔WS bridge started for room '{}'", room_name);

    loop {
        tokio::select! {
            // === BLE → WS: Direct data from GATT peers ===
            Some(data) = ble_recv_rx.recv() => {
                if let Ok(text) = String::from_utf8(data) {
                    if text.starts_with(WS_PREFIX) {
                        let json = &text[WS_PREFIX.len()..];
                        // Mark content hash so we don't echo it back to BLE
                        // Use "ble-" prefix so relay's forwarding isn't blocked
                        let hash = format!("ble-echo-{}", fxhash(json));
                        {
                            let mut ids = seen_ids.write().await;
                            if ids.contains(&hash) {
                                continue;
                            }
                            ids.insert(hash);
                        }
                        handle_ble_ws_message(json, &hub, &room_name, &seen_ids, &voice_incoming_tx).await;
                    }
                }
            }

            // === WS → BLE: Hub room broadcasts (chat messages in "general") ===
            Ok(broadcast) = room_rx.recv() => {
                forward_ws_to_ble(&broadcast, &ble_send_tx, &seen_ids).await;
            }

            // === WS → BLE: Downstream messages (DMs, peer_updates from upstream) ===
            Ok(downstream) = downstream_rx.recv() => {
                forward_ws_to_ble(&downstream, &ble_send_tx, &seen_ids).await;
            }

            // === WS → BLE: Passthrough messages (user actions: start_dm, CoT, voice, etc.) ===
            Ok(passthrough) = passthrough_rx.recv() => {
                forward_ws_to_ble(&passthrough, &ble_send_tx, &seen_ids).await;
            }

            // === BLE peer events → peer_update in Hub + initial sync ===
            Some(event) = ble_event_rx.recv() => {
                match &event {
                    BlePeerEvent::PeerConnected(info) => {
                        tracing::info!("BLE peer connected: {} ({})", info.name, info.id);
                        ble_peer_names.insert(info.id.clone(), info.name.clone());
                        broadcast_ble_peer_update(&hub, &room_name, info, "joined", &self_node_id).await;

                        // Register BLE peer with Go server so Mac can see and DM them
                        let reg = crate::ws_server::make_json("register_ble_peer", &serde_json::json!({
                            "peer_id": info.id,
                            "peer_name": info.name,
                        }));
                        let _ = hub.passthrough_tx.send(Arc::new(reg));

                        sync_room_history_to_ble(&hub, &room_name, &ble_send_tx).await;
                    }
                    BlePeerEvent::PeerDisconnected(info) => {
                        tracing::info!("BLE peer disconnected: {} ({})", info.name, info.id);
                        ble_peer_names.remove(&info.id);
                        broadcast_ble_peer_update(&hub, &room_name, info, "left", &self_node_id).await;

                        let unreg = crate::ws_server::make_json("unregister_ble_peer", &serde_json::json!({
                            "peer_id": info.id,
                        }));
                        let _ = hub.passthrough_tx.send(Arc::new(unreg));
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
                let _ = ble_send_tx.send(payload.into_bytes());
            }

            // === Periodic BLE peer state → mesh_state ===
            _ = peer_interval.tick() => {
                if !ble_peer_names.is_empty() {
                    broadcast_ble_mesh_state_from_map(&hub, &room_name, &ble_peer_names, &self_node_id).await;
                }
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

                    let key = format!("ble-in-{}", msg_id);
                    let mut ids = seen_ids.write().await;
                    if ids.contains(&key) {
                        return;
                    }
                    ids.insert(key);
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

/// Forward a WS message to BLE peers via direct GATT transport.
#[cfg(feature = "bluetooth")]
async fn forward_ws_to_ble(
    broadcast: &str,
    ble_send_tx: &mpsc::UnboundedSender<Vec<u8>>,
    seen_ids: &SeenIds,
) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(broadcast) else {
        return;
    };

    let msg_type = envelope
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Skip types that shouldn't be forwarded to BLE peers
    match msg_type {
        "identity" | "name_assigned" => return,
        _ => {}
    }

    // Check echo prevention — only block if this exact content came from BLE
    let hash = format!("ble-echo-{}", fxhash(broadcast));
    {
        let ids = seen_ids.read().await;
        if ids.contains(&hash) {
            return; // This came from BLE — don't echo back
        }
    }

    let payload = format!("{}{}", WS_PREFIX, broadcast);
    let _ = ble_send_tx.send(payload.into_bytes());
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

/// Send room history to BLE peers when they first connect.
/// This syncs the new peer with messages from the Go server.
#[cfg(feature = "bluetooth")]
async fn sync_room_history_to_ble(
    hub: &Arc<Hub>,
    room_name: &str,
    ble_send_tx: &mpsc::UnboundedSender<Vec<u8>>,
) {
    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    let room_id = crate::ws_server::chat_id_hex(&chat_id);

    // Get room history from local Hub
    let rooms = hub.rooms.read().await;
    let messages = if let Some(room_arc) = rooms.get(&chat_id) {
        let room = room_arc.read().await;
        room.messages.clone()
    } else {
        return;
    };
    drop(rooms);

    if messages.is_empty() {
        tracing::info!("No room history to sync to BLE peer");
        return;
    }

    tracing::info!("Syncing {} messages to BLE peer (one at a time)", messages.len());

    // Send each message individually so each fits in a single GATT write
    for msg in &messages {
        let msg_envelope = serde_json::json!({
            "type": "message",
            "data": {
                "room_id": room_id,
                "message": msg,
            }
        });
        let payload = format!("{}{}", WS_PREFIX, msg_envelope);
        let _ = ble_send_tx.send(payload.into_bytes());
    }
}

/// Broadcast BLE peers from local tracking map (not peat-btle's internal list).
#[cfg(feature = "bluetooth")]
async fn broadcast_ble_mesh_state_from_map(
    hub: &Arc<Hub>,
    room_name: &str,
    peers: &std::collections::HashMap<String, String>,
    self_node_id: &str,
) {
    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    let room_id = crate::ws_server::chat_id_hex(&chat_id);

    let ble_peers: Vec<serde_json::Value> = peers
        .iter()
        .map(|(id, name)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "short_id": if id.len() >= 12 { &id[..12] } else { &id[..] },
                "transport": "btle",
                "latency_ms": 0,
                "state": "connected",
                "connected_at": crate::ws_server::now_ms(),
                "connected_via": self_node_id,
            })
        })
        .collect();

    let msg = crate::ws_server::make_json(
        "ble_mesh_state",
        &serde_json::json!({
            "room_id": room_id,
            "peers": ble_peers,
        }),
    );
    let msg_arc = Arc::new(msg);
    let _ = hub.downstream_tx.send(msg_arc.clone());
    let _ = hub.passthrough_tx.send(msg_arc);
}

/// Broadcast BLE peers as mesh_state with connected_via field (from peat-btle).
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
