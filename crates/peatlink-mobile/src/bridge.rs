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

/// Filter out our own node from incoming mesh/ble_mesh_state so we don't see ourselves.
fn filter_self_from_mesh(json: &str, self_node_id: &str) -> Option<String> {
    let mut envelope: serde_json::Value = serde_json::from_str(json).ok()?;
    let msg_type = envelope.get("type")?.as_str()?;

    if msg_type != "ble_mesh_state" && msg_type != "mesh_state" {
        return None; // not a mesh message, no filtering needed
    }

    let data = envelope.get_mut("data")?;
    if let Some(peers) = data.get_mut("peers").and_then(|v| v.as_array_mut()) {
        let self_id = self_node_id;
        peers.retain(|p| {
            let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
            id != self_id
        });
    }

    Some(serde_json::to_string(&envelope).ok()?)
}

fn rewrite_relayed_mesh_for_ble(
    mut envelope: serde_json::Value,
    source_peer_id: &str,
    ble_peers: &BlePeerDirectory,
) -> Option<String> {
    let data = envelope.get_mut("data")?;
    let peers = data.get_mut("peers")?.as_array_mut()?;
    let (relay_id, relay_name) = ble_peers
        .resolve_sender(source_peer_id)
        .unwrap_or_else(|| (source_peer_id.to_string(), source_peer_id.to_string()));

    if relay_id.is_empty() {
        return serde_json::to_string(&envelope).ok();
    }

    let mut saw_relay = false;
    for peer in peers.iter_mut() {
        let peer_id = peer.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if peer_id == relay_id {
            saw_relay = true;
            if let Some(obj) = peer.as_object_mut() {
                obj.remove("connected_via");
                obj.insert(
                    "transport".to_string(),
                    serde_json::Value::String("btle".to_string()),
                );
            }
            continue;
        }

        if peer.get("connected_via").is_none() {
            peer["connected_via"] = serde_json::Value::String(relay_id.clone());
        }
    }

    if !saw_relay {
        peers.push(serde_json::json!({
            "id": relay_id,
            "name": relay_name,
            "short_id": if relay_id.len() >= 12 { &relay_id[..12] } else { &relay_id[..] },
            "transport": "btle",
            "latency_ms": 0,
            "state": "connected",
            "connected_at": crate::ws_server::now_ms(),
        }));
    }

    serde_json::to_string(&envelope).ok()
}

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

#[derive(Default)]
struct BlePeerDirectory {
    names_by_id: std::collections::HashMap<String, String>,
    source_to_node: std::collections::HashMap<String, String>,
}

impl BlePeerDirectory {
    fn upsert_peer(&mut self, node_id: String, name: String) {
        self.names_by_id.insert(node_id, name);
    }

    fn upsert_source(&mut self, source_peer_id: &str, name: String) {
        if source_peer_id.is_empty() {
            return;
        }
        self.names_by_id.insert(source_peer_id.to_string(), name);
    }

    fn bind_source(&mut self, source_peer_id: &str, node_id: &str) {
        if source_peer_id.is_empty() {
            return;
        }
        self.source_to_node
            .insert(source_peer_id.to_string(), node_id.to_string());
    }

    fn remove_peer(&mut self, node_id: &str) {
        self.names_by_id.remove(node_id);
        self.source_to_node.retain(|_, mapped| mapped != node_id);
    }

    fn promote_source(
        &mut self,
        source_peer_id: &str,
        node_id: String,
        name: String,
    ) -> Option<String> {
        let provisional = if !source_peer_id.is_empty() && source_peer_id != node_id {
            self.names_by_id
                .remove(source_peer_id)
                .map(|_| source_peer_id.to_string())
        } else {
            None
        };
        self.bind_source(source_peer_id, &node_id);
        self.upsert_peer(node_id, name);
        provisional
    }

    fn disconnect_source(&mut self, source_peer_id: &str) -> Vec<String> {
        let mut removed = Vec::new();
        if source_peer_id.is_empty() {
            return removed;
        }

        if let Some(node_id) = self.source_to_node.remove(source_peer_id) {
            if self.names_by_id.remove(&node_id).is_some() {
                removed.push(node_id);
            }
        }

        if self.names_by_id.remove(source_peer_id).is_some() {
            let source = source_peer_id.to_string();
            if !removed.iter().any(|id| id == &source) {
                removed.push(source);
            }
        }

        removed
    }

    fn resolve_sender(&self, source_peer_id: &str) -> Option<(String, String)> {
        if !source_peer_id.is_empty() {
            if let Some(name) = self.names_by_id.get(source_peer_id) {
                return Some((source_peer_id.to_string(), name.clone()));
            }
            if let Some(node_id) = self.source_to_node.get(source_peer_id) {
                if let Some(name) = self.names_by_id.get(node_id) {
                    return Some((node_id.clone(), name.clone()));
                }
            }
        }

        if self.names_by_id.len() == 1 {
            return self
                .names_by_id
                .iter()
                .next()
                .map(|(id, name)| (id.clone(), name.clone()));
        }

        None
    }
}

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
pub(crate) async fn start_bridge(
    hub: Arc<Hub>,
    _ble_manager: Arc<BleManager>,
    ble_event_rx: mpsc::UnboundedReceiver<BlePeerEvent>,
    room_name: String,
    seen_ids: SeenIds,
    self_node_id: String,
    voice_outgoing_rx: mpsc::UnboundedReceiver<crate::VoiceFrame>,
    voice_incoming_tx: mpsc::UnboundedSender<crate::VoiceFrame>,
    ble_recv_rx: mpsc::UnboundedReceiver<crate::BleInboundPacket>,
    ble_send_tx: mpsc::UnboundedSender<Vec<u8>>,
) -> BridgeHandle {
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

    tokio::spawn(bridge_loop(
        hub,
        _ble_manager,
        ble_event_rx,
        room_name,
        seen_ids,
        self_node_id,
        shutdown_rx,
        voice_outgoing_rx,
        voice_incoming_tx,
        ble_recv_rx,
        ble_send_tx,
    ));

    BridgeHandle { shutdown_tx }
}

#[cfg(feature = "bluetooth")]
async fn bridge_loop(
    hub: Arc<Hub>,
    _ble_manager: Arc<BleManager>,
    mut ble_event_rx: mpsc::UnboundedReceiver<BlePeerEvent>,
    room_name: String,
    seen_ids: SeenIds,
    self_node_id: String,
    mut shutdown_rx: mpsc::Receiver<()>,
    mut voice_outgoing_rx: mpsc::UnboundedReceiver<crate::VoiceFrame>,
    voice_incoming_tx: mpsc::UnboundedSender<crate::VoiceFrame>,
    mut ble_recv_rx: mpsc::UnboundedReceiver<crate::BleInboundPacket>,
    ble_send_tx: mpsc::UnboundedSender<Vec<u8>>,
) {
    // Subscribe to local Hub room broadcasts (WS → BLE direction)
    let mut room_rx = hub.subscribe_room(&room_name).await;

    // Subscribe to downstream only (DMs, reactions, server broadcasts from upstream relay)
    // Do NOT subscribe to passthrough — the bridge puts BLE messages on passthrough,
    // and subscribing would create a self-loop where every received message echoes back
    let mut downstream_rx = hub.downstream_tx.subscribe();

    let mut peer_interval = tokio::time::interval(Duration::from_secs(5));

    // Track BLE peers locally (since peat-btle's peer list may be empty)
    let mut ble_peers = BlePeerDirectory::default();

    // Voice-aware mesh sync rate-limiting (Serval Rhizome-inspired backoff)
    let mut last_voice_activity = std::time::Instant::now() - Duration::from_secs(60);

    tracing::info!("BLE↔WS bridge started for room '{}'", room_name);

    loop {
        tokio::select! {
            // === BLE → WS: Direct data from GATT peers ===
            Some(packet) = ble_recv_rx.recv() => {
                if let Ok(text) = String::from_utf8(packet.data) {
                    if text.starts_with(WS_PREFIX) {
                        let json = &text[WS_PREFIX.len()..];

                        // Message ID dedup — drop messages we sent to BLE that echoed back
                        if let Ok(env) = serde_json::from_str::<serde_json::Value>(json) {
                            if let Some(msg_id) = env.pointer("/data/message/id").and_then(|v| v.as_str()) {
                                let key = format!("ble-sent-{}", msg_id);
                                let ids = seen_ids.read().await;
                                if ids.contains(&key) {
                                    continue; // We sent this — it echoed back from BLE peer
                                }
                            }
                        }

                        // Content hash dedup — prevents dual-GATT duplicates
                        let hash = format!("ble-echo-{}", fxhash(json));
                        {
                            let mut ids = seen_ids.write().await;
                            if ids.contains(&hash) {
                                continue;
                            }
                            ids.insert(hash);
                        }

                        // Filter out ble_mesh_state entries that refer to ourselves
                        let filtered = filter_self_from_mesh(json, &self_node_id);
                        let json_ref = filtered.as_deref().unwrap_or(json);

                        handle_ble_ws_message(
                            json_ref,
                            &packet.peer_id,
                            &hub,
                            &room_name,
                            &seen_ids,
                            &voice_incoming_tx,
                            &mut ble_peers,
                            &self_node_id,
                        )
                        .await;
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

            // NOTE: passthrough is NOT subscribed — bridge puts messages on passthrough
            // for the upstream relay, subscribing would create a self-loop

            // === BLE peer events → peer_update in Hub + initial sync ===
            Some(event) = ble_event_rx.recv() => {
                match &event {
                    BlePeerEvent::PeerConnected(info) => {
                        tracing::info!("BLE peer connected: {} ({})", info.name, info.id);
                        ble_peers.upsert_source(&info.id, info.name.clone());
                        broadcast_ble_peer_update(&hub, &room_name, info, "joined", &self_node_id).await;

                        // Register BLE peer with Go server (initial name, will be updated by hello)
                        let reg = crate::ws_server::make_json("register_ble_peer", &serde_json::json!({
                            "peer_id": info.id,
                            "peer_name": info.name,
                        }));
                        let _ = hub.passthrough_tx.send(Arc::new(reg));

                        // Send our callsign to the BLE peer so they know who we are
                        let our_name = hub.default_display_name.read().await.clone();
                        let display = if our_name.is_empty() {
                            // Fallback: use short node_id if callsign not set yet
                            format!("node-{}", &self_node_id[..self_node_id.len().min(8)])
                        } else {
                            our_name
                        };
                        let hello = serde_json::json!({
                            "type": "ble_hello",
                            "data": {
                                "node_id": self_node_id,
                                "callsign": display,
                            }
                        });
                        let payload = format!("{}{}", WS_PREFIX, hello);
                        let _ = ble_send_tx.send(payload.into_bytes());

                        sync_room_history_to_ble(&hub, &room_name, &ble_send_tx).await;
                    }
                    BlePeerEvent::PeerDisconnected(info) => {
                        tracing::info!("BLE peer disconnected: {} ({})", info.name, info.id);
                        let effective = ble_peers
                            .resolve_sender(&info.id)
                            .unwrap_or_else(|| (info.id.clone(), info.name.clone()));
                        let effective_info = crate::ble::BlePeerInfo {
                            id: effective.0.clone(),
                            name: effective.1.clone(),
                            rssi: info.rssi,
                            is_connected: false,
                            last_seen_ms: info.last_seen_ms,
                            transport: info.transport.clone(),
                        };
                        let removed_ids = ble_peers.disconnect_source(&info.id);
                        broadcast_ble_peer_update(&hub, &room_name, &effective_info, "left", &self_node_id).await;

                        for peer_id in removed_ids {
                            let unreg = crate::ws_server::make_json("unregister_ble_peer", &serde_json::json!({
                                "peer_id": peer_id,
                            }));
                            let _ = hub.passthrough_tx.send(Arc::new(unreg));
                        }
                    }
                }
            }

            // === Voice: outgoing audio frames → BLE ===
            Some(frame) = voice_outgoing_rx.recv() => {
                last_voice_activity = std::time::Instant::now();
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

            // === Periodic BLE peer state → mesh_state + re-register upstream ===
            _ = peer_interval.tick() => {
                // Skip mesh broadcast if voice was active in the last 2 seconds (Serval-inspired backoff)
                if last_voice_activity.elapsed() < Duration::from_secs(2) {
                    continue;
                }
                if !ble_peers.names_by_id.is_empty() {
                    broadcast_ble_mesh_state_from_map(&hub, &room_name, &ble_peers.names_by_id, &self_node_id).await;

                    // Re-register BLE peers with upstream Go server periodically.
                    // This ensures peers are visible even if the upstream relay
                    // connected AFTER the BLE peer (initial registration was lost
                    // because broadcast channels only deliver after subscription).
                    for (peer_id, peer_name) in ble_peers.names_by_id.iter() {
                        if peer_id.contains(':') { continue; } // skip provisional MAC entries
                        let reg = crate::ws_server::make_json("register_ble_peer", &serde_json::json!({
                            "peer_id": peer_id,
                            "peer_name": peer_name,
                        }));
                        let _ = hub.passthrough_tx.send(Arc::new(reg));
                    }
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
    source_peer_id: &str,
    hub: &Arc<Hub>,
    room_name: &str,
    seen_ids: &SeenIds,
    voice_incoming_tx: &mpsc::UnboundedSender<crate::VoiceFrame>,
    ble_peers: &mut BlePeerDirectory,
    self_node_id: &str,
) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(json) else {
        return;
    };

    let msg_type = envelope.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();

    match msg_type.as_str() {
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
                        if let Ok(mut chat_msg) =
                            serde_json::from_value::<ChatMessage>(msg_val.clone())
                        {
                            // Only override sender if the message doesn't already have a name
                            // (messages from the remote WebView already have correct sender_name)
                            if chat_msg.sender_name.is_empty() || chat_msg.sender_name.starts_with("anon-") {
                                if let Some((sender_id, sender_name)) =
                                    ble_peers.resolve_sender(source_peer_id)
                                {
                                    chat_msg.sender = sender_id;
                                    chat_msg.sender_name = sender_name;
                                }
                            }
                            // Inject into local Hub (shows on WiFi phone WebView)
                            hub.inject_external_message(room_name, chat_msg.clone()).await;

                            // Send as pre-formatted send_message via passthrough
                            // (goes directly to Go server with correct sender_name,
                            // separate from relay_tx which carries WiFi phone's own messages)
                            let fwd = crate::ws_server::make_json(
                                "send_message",
                                &serde_json::json!({
                                    "room_id": room_id,
                                    "content": chat_msg.content,
                                    "message_id": chat_msg.id,
                                    "sender_id": chat_msg.sender,
                                    "sender_name": chat_msg.sender_name,
                                }),
                            );
                            let _ = hub.passthrough_tx.send(Arc::new(fwd));
                        }
                    } else {
                        // DM or other room — send via downstream
                        let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
                    }
                }
            }
        }

        // BLE handshake — remote peer is telling us their callsign and node_id
        "ble_hello" => {
            if let Some(data) = envelope.get("data") {
                let node_id = data
                    .get("node_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let callsign = data
                    .get("callsign")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if !node_id.is_empty() {
                    let callsign = if callsign.is_empty() {
                        format!("node-{}", &node_id[..node_id.len().min(8)])
                    } else {
                        callsign
                    };
                    tracing::info!(
                        "BLE hello from {} ({})",
                        callsign,
                        &node_id[..node_id.len().min(12)]
                    );
                    if let Some(provisional_id) =
                        ble_peers.promote_source(source_peer_id, node_id.clone(), callsign.clone())
                    {
                        let unreg = crate::ws_server::make_json(
                            "unregister_ble_peer",
                            &serde_json::json!({
                                "peer_id": provisional_id,
                            }),
                        );
                        let _ = hub.passthrough_tx.send(Arc::new(unreg));
                    }

                    let reg = crate::ws_server::make_json(
                        "register_ble_peer",
                        &serde_json::json!({
                            "peer_id": node_id,
                            "peer_name": callsign,
                        }),
                    );
                    let _ = hub.passthrough_tx.send(Arc::new(reg));

                    // Immediately broadcast updated mesh state with the promoted node_id
                    broadcast_ble_mesh_state_from_map(&hub, &room_name, &ble_peers.names_by_id, &self_node_id).await;
                }
            }
        }

        // Voice audio frames — decode and push to incoming queue for Kotlin playback
        "voice_audio" => {
            if let Some(data) = envelope.get("data") {
                let audio_b64 = data.get("audio").and_then(|v| v.as_str()).unwrap_or("");
                let sender_id = data
                    .get("sender_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let sender_name = data
                    .get("sender_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
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
        "dm_opened"
        | "room_joined"
        | "room_history"
        | "peer_update"
        | "message_edited"
        | "message_deleted"
        | "reaction_updated"
        | "message_pinned"
        | "message_unpinned"
        | "voice_state"
        | "voice_channel_created"
        | "voice_peer_joined"
        | "voice_peer_left"
        | "voice_offer_relay"
        | "voice_answer_relay"
        | "voice_ice_relay"
        | "voice_speaking_broadcast"
        | "cot_state"
        | "marker_created"
        | "marker_deleted" => {
            let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
        }

        "mesh_state" => {
            let rewritten = rewrite_relayed_mesh_for_ble(envelope, source_peer_id, ble_peers)
                .unwrap_or_else(|| json.to_string());
            let _ = hub.downstream_tx.send(Arc::new(rewritten));
            // Also forward original to upstream so Go server sees BLE peer mesh view
            let _ = hub.passthrough_tx.send(Arc::new(json.to_string()));
        }

        // CoT position from BLE peer — store locally and broadcast cot_state
        "cot_position" => {
            let mut cot: serde_json::Value = envelope;
            if let Some(data) = cot.get_mut("data") {
                if let Some((id, name)) = ble_peers.resolve_sender(source_peer_id) {
                    data["sender_id"] = serde_json::Value::String(id);
                    data["sender_name"] = serde_json::Value::String(name);
                }
            }
            let cot_json = serde_json::to_string(&cot).unwrap_or_default();

            // Store position in local room and broadcast cot_state so relay WebView
            // shows the BLE peer's GPS position
            let chat_id = crate::ws_server::chat_id_from_name(room_name);
            let rid = crate::ws_server::chat_id_hex(&chat_id);
            let rooms = hub.rooms.read().await;
            if let Some(room_arc) = rooms.get(&chat_id) {
                let mut room = room_arc.write().await;
                if let Some(data) = cot.get("data") {
                    let sid = data.get("sender_id").and_then(|v| v.as_str()).unwrap_or(source_peer_id);
                    room.cot_positions.insert(sid.to_string(), data.clone());
                }
                // Broadcast full cot_state to local clients
                let contacts: Vec<serde_json::Value> = room.cot_positions.values().cloned().collect();
                let markers: Vec<serde_json::Value> = room.markers.clone();
                let state_msg = crate::ws_server::make_json("cot_state", &serde_json::json!({
                    "room_id": rid,
                    "contacts": contacts,
                    "markers": markers,
                }));
                let _ = room.tx.send(Arc::new(state_msg));
            }
            drop(rooms);

            let _ = hub.passthrough_tx.send(Arc::new(cot_json));
        }

        // BLE peer set_name — update peer directory only, do NOT forward to Go server
        // (forwarding would overwrite the relay's own name on the Go server)
        "set_name" => {
            if let Some(data) = envelope.get("data") {
                if let Some(name) = data.get("name").and_then(|v| v.as_str()) {
                    if !name.is_empty() {
                        if let Some((id, _)) = ble_peers.resolve_sender(source_peer_id) {
                            tracing::info!("BLE peer {} set name to '{}'", &id[..id.len().min(12)], name);
                            ble_peers.upsert_peer(id.clone(), name.to_string());
                            // Re-register with Go server using updated name
                            let reg = crate::ws_server::make_json("register_ble_peer", &serde_json::json!({
                                "peer_id": id,
                                "peer_name": name,
                            }));
                            let _ = hub.passthrough_tx.send(Arc::new(reg));
                        }
                    }
                }
            }
        }

        // User-initiated actions from remote BLE peer — forward to passthrough AND inject locally
        "send_message" | "start_dm" | "join_dm" | "edit_message"
        | "delete_message" | "add_reaction" | "remove_reaction" | "pin_message"
        | "unpin_message" | "join_voice" | "leave_voice" | "voice_offer" | "voice_answer"
        | "voice_ice" | "create_marker" | "delete_marker" | "voice_speaking" => {
            let mut outbound = envelope;
            if let Some(data) = outbound.get_mut("data") {
                if let Some((id, name)) = ble_peers.resolve_sender(source_peer_id) {
                    data["sender_id"] = serde_json::Value::String(id);
                    data["sender_name"] = serde_json::Value::String(name);
                }
            }
            let out_json = serde_json::to_string(&outbound).unwrap_or_default();

            // Voice and CoT actions from BLE peers need to generate server-style
            // response events locally so the relay phone's WebView sees them.
            // Without upstream, passthrough goes nowhere — we must process locally.
            let data = outbound.get("data");
            let room_id_str = data.and_then(|d| d.get("room_id")).and_then(|v| v.as_str()).unwrap_or("");
            let sender_id = data.and_then(|d| d.get("sender_id")).and_then(|v| v.as_str()).unwrap_or(source_peer_id);
            let sender_name_val = data.and_then(|d| d.get("sender_name")).and_then(|v| v.as_str()).unwrap_or("");

            match msg_type.as_str() {
                "join_voice" => {
                    let channel_id = data.and_then(|d| d.get("channel_id")).and_then(|v| v.as_str()).unwrap_or("");
                    let joined_msg = crate::ws_server::make_json("voice_peer_joined", &serde_json::json!({
                        "room_id": room_id_str,
                        "channel_id": channel_id,
                        "peer_id": sender_id,
                        "name": sender_name_val,
                    }));
                    inject_into_room(hub, room_name, &joined_msg).await;
                }
                "leave_voice" => {
                    let channel_id = data.and_then(|d| d.get("channel_id")).and_then(|v| v.as_str()).unwrap_or("");
                    let left_msg = crate::ws_server::make_json("voice_peer_left", &serde_json::json!({
                        "room_id": room_id_str,
                        "channel_id": channel_id,
                        "peer_id": sender_id,
                    }));
                    inject_into_room(hub, room_name, &left_msg).await;
                }
                "voice_speaking" => {
                    let channel_id = data.and_then(|d| d.get("channel_id")).and_then(|v| v.as_str()).unwrap_or("");
                    let speaking = data.and_then(|d| d.get("speaking")).and_then(|v| v.as_bool()).unwrap_or(false);
                    let speak_msg = crate::ws_server::make_json("voice_speaking_broadcast", &serde_json::json!({
                        "room_id": room_id_str,
                        "channel_id": channel_id,
                        "peer_id": sender_id,
                        "speaking": speaking,
                    }));
                    inject_into_room(hub, room_name, &speak_msg).await;
                }
                "voice_offer" | "voice_answer" | "voice_ice" => {
                    let relay_type = match msg_type.as_str() {
                        "voice_offer" => "voice_offer_relay",
                        "voice_answer" => "voice_answer_relay",
                        _ => "voice_ice_relay",
                    };
                    let relay_msg = crate::ws_server::make_json(relay_type, &serde_json::json!({
                        "room_id": room_id_str,
                        "channel_id": data.and_then(|d| d.get("channel_id")).and_then(|v| v.as_str()).unwrap_or(""),
                        "from_id": sender_id,
                        "sdp": data.and_then(|d| d.get("sdp")).unwrap_or(&serde_json::Value::Null),
                        "candidate": data.and_then(|d| d.get("candidate")).unwrap_or(&serde_json::Value::Null),
                    }));
                    inject_into_room(hub, room_name, &relay_msg).await;
                }
                _ => {}
            }

            let _ = hub.passthrough_tx.send(Arc::new(out_json));
        }

        _ => {
            // Unknown type — forward via downstream as best effort
            let _ = hub.downstream_tx.send(Arc::new(json.to_string()));
        }
    }
}

/// Helper: get the hex room ID for a room name.
fn room_id_for_room(room_name: &str) -> String {
    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    crate::ws_server::chat_id_hex(&chat_id)
}

/// Inject a JSON message into a local room's broadcast channel.
/// This makes BLE peer actions visible to the relay phone's WebView
/// even when there's no upstream server to process them.
#[cfg(feature = "bluetooth")]
async fn inject_into_room(hub: &Arc<Hub>, room_name: &str, json: &str) {
    let chat_id = crate::ws_server::chat_id_from_name(room_name);
    let rooms = hub.rooms.read().await;
    if let Some(room_arc) = rooms.get(&chat_id) {
        let room = room_arc.read().await;
        let _ = room.tx.send(Arc::new(json.to_string()));
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

    let msg_type = envelope.get("type").and_then(|v| v.as_str()).unwrap_or("");

    // Skip types that shouldn't be forwarded to BLE peers
    match msg_type {
        "identity" | "name_assigned" | "ble_mesh_state"
        | "voice_offer_relay" | "voice_answer_relay" | "voice_ice_relay"
        // voice_speaking is too chatty for BLE GATT bandwidth
        | "voice_speaking"
        // DMs are private — don't leak to BLE peers that aren't participants
        | "dm_opened" => return,
        _ => {}
    }

    // Filter DM room_joined/room_history (check is_dm flag in data)
    if msg_type == "room_joined" || msg_type == "room_history" {
        if let Some(data) = envelope.get("data") {
            if data.get("is_dm").and_then(|v| v.as_bool()).unwrap_or(false) {
                return;
            }
        }
    }

    // For messages, track by ID so we drop echoes when they come back from BLE
    if msg_type == "message" {
        if let Ok(env) = serde_json::from_str::<serde_json::Value>(broadcast) {
            if let Some(msg_id) = env.pointer("/data/message/id").and_then(|v| v.as_str()) {
                let mut ids = seen_ids.write().await;
                ids.insert(format!("ble-sent-{}", msg_id));
            }
        }
    }

    // Check echo prevention — block if content hash or message ID was seen from BLE
    let hash = format!("ble-echo-{}", fxhash(broadcast));
    {
        let ids = seen_ids.read().await;
        if ids.contains(&hash) {
            return;
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

    tracing::info!(
        "Syncing {} messages to BLE peer (one at a time)",
        messages.len()
    );

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

    let ble_peers_local: Vec<serde_json::Value> = peers
        .iter()
        .filter(|(id, _)| !id.contains(':')) // skip provisional MAC entries
        .map(|(id, name)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "short_id": if id.len() >= 12 { &id[..12] } else { &id[..] },
                "transport": "btle",
                "latency_ms": 0,
                "state": "connected",
                "connected_at": crate::ws_server::now_ms(),
            })
        })
        .collect();

    let ble_peers_upstream: Vec<serde_json::Value> = peers
        .iter()
        .filter(|(id, _)| !id.contains(':')) // skip provisional MAC entries
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

    let local_msg = crate::ws_server::make_json(
        "ble_mesh_state",
        &serde_json::json!({
            "room_id": room_id,
            "peers": ble_peers_local,
        }),
    );
    let upstream_msg = crate::ws_server::make_json(
        "ble_mesh_state",
        &serde_json::json!({
            "room_id": room_id,
            "peers": ble_peers_upstream,
        }),
    );
    let _ = hub.downstream_tx.send(Arc::new(local_msg));
    let _ = hub.passthrough_tx.send(Arc::new(upstream_msg));
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
