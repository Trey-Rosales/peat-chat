use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use tower_http::cors::CorsLayer;

// ---------- message types (matching Go server JSON) ----------

pub type ChatId = [u8; 32];

pub fn chat_id_from_name(name: &str) -> ChatId {
    *blake3::hash(name.as_bytes()).as_bytes()
}

pub fn chat_id_hex(id: &ChatId) -> String {
    hex::encode(id)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub sender: String,
    pub sender_name: String,
    pub timestamp: u64,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct WsEnvelope {
    r#type: String,
    data: serde_json::Value,
}

// ---------- room ----------

pub(crate) struct Room {
    pub(crate) name: String,
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) members: HashMap<u64, ClientInfo>,
    pub(crate) tx: broadcast::Sender<Arc<String>>,
    // Voice channels
    voice_channels: Vec<VoiceChannel>,
    // CoT positions (client_id -> position data)
    pub(crate) cot_positions: HashMap<String, serde_json::Value>,
    // Map markers
    pub(crate) markers: Vec<serde_json::Value>,
    // DM metadata
    is_dm: bool,
    dm_participants: [String; 2], // sorted pair of identity IDs
}

struct VoiceChannel {
    id: String,
    name: String,
    members: HashMap<String, String>, // peer_id -> peer_name
}

#[derive(Clone)]
struct ClientInfo {
    id: String,
    name: String,
    transport: String,
    connected_at: u64,
}

impl Room {
    fn new(name: String) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            name,
            messages: Vec::new(),
            members: HashMap::new(),
            tx,
            voice_channels: vec![VoiceChannel {
                id: "default".to_string(),
                name: "General".to_string(),
                members: HashMap::new(),
            }],
            cot_positions: HashMap::new(),
            markers: Vec::new(),
            is_dm: false,
            dm_participants: [String::new(), String::new()],
        }
    }

    fn member_count(&self) -> usize {
        self.members.len()
    }
}

// ---------- hub (shared state) ----------

pub struct Hub {
    pub rooms: RwLock<HashMap<ChatId, Arc<RwLock<Room>>>>,
    next_client_id: RwLock<u64>,
    server_identity: String,
    /// Default display name for clients (set from MobileNode callsign).
    pub default_display_name: RwLock<String>,
    /// Data directory for persisting callsign etc.
    pub data_dir: Option<String>,
    /// Channel for messages the local server doesn't handle — relayed upstream.
    pub passthrough_tx: broadcast::Sender<Arc<String>>,
    /// Dedicated channel for the upstream relay (user-originated chat messages).
    pub relay_tx: broadcast::Sender<Arc<String>>,
    /// Channel for messages from upstream that should be sent to all local WebView clients.
    pub downstream_tx: broadcast::Sender<Arc<String>>,
    /// Known peers from mesh state / peer updates (identity -> name).
    /// Used for local DM peer lookup when offline.
    known_peers: RwLock<HashMap<String, String>>,
    /// Active client sessions (client_id -> (identity, sender)).
    /// Used to deliver DM notifications to local WebSocket clients.
    active_sessions: RwLock<HashMap<u64, (String, mpsc::Sender<Arc<String>>)>>,
}

impl Hub {
    fn new(data_dir: Option<String>) -> Self {
        let id = hex::encode(rand::random::<[u8; 16]>());
        let (passthrough_tx, _) = broadcast::channel(256);
        let (relay_tx, _) = broadcast::channel(256);
        let (downstream_tx, _) = broadcast::channel(256);
        Self {
            rooms: RwLock::new(HashMap::new()),
            next_client_id: RwLock::new(1),
            server_identity: id,
            default_display_name: RwLock::new(String::new()),
            data_dir,
            passthrough_tx,
            relay_tx,
            downstream_tx,
            known_peers: RwLock::new(HashMap::new()),
            active_sessions: RwLock::new(HashMap::new()),
        }
    }

    async fn next_id(&self) -> u64 {
        let mut id = self.next_client_id.write().await;
        let v = *id;
        *id += 1;
        v
    }

    async fn get_or_create_room(&self, name: &str) -> Arc<RwLock<Room>> {
        let chat_id = chat_id_from_name(name);
        {
            let rooms = self.rooms.read().await;
            if let Some(room) = rooms.get(&chat_id) {
                return room.clone();
            }
        }
        let mut rooms = self.rooms.write().await;
        rooms
            .entry(chat_id)
            .or_insert_with(|| {
                tracing::info!("created room: {} ({})", name, &hex::encode(chat_id)[..16]);
                Arc::new(RwLock::new(Room::new(name.to_string())))
            })
            .clone()
    }

    pub async fn find_room_by_hex(&self, hex_id: &str) -> Option<(ChatId, Arc<RwLock<Room>>)> {
        let rooms = self.rooms.read().await;
        for (id, room) in rooms.iter() {
            let full = chat_id_hex(id);
            if full == hex_id || full.starts_with(hex_id) {
                return Some((*id, room.clone()));
            }
        }
        None
    }

    /// Inject an externally-sourced message (from upstream relay or BLE bridge) into a room.
    /// Deduplicates by message ID to prevent duplicates from multiple sources.
    pub async fn inject_external_message(&self, room_name: &str, msg: ChatMessage) {
        let room_arc = self.get_or_create_room(room_name).await;
        let chat_id = chat_id_from_name(room_name);
        let room_id = chat_id_hex(&chat_id);
        let mut room = room_arc.write().await;
        // Check if this message ID already exists in the room
        if room.messages.iter().any(|m| m.id == msg.id) {
            return; // duplicate
        }
        room.messages.push(msg.clone());
        if room.messages.len() > 1000 {
            let excess = room.messages.len() - 1000;
            room.messages.drain(..excess);
        }
        let broadcast = make_json(
            "message",
            &serde_json::json!({
                "room_id": room_id,
                "message": msg,
            }),
        );
        let _ = room.tx.send(Arc::new(broadcast));
    }

    /// Subscribe to broadcast messages from a room (for relay/bridge consumers).
    pub async fn subscribe_room(&self, room_name: &str) -> broadcast::Receiver<Arc<String>> {
        let room_arc = self.get_or_create_room(room_name).await;
        let room = room_arc.read().await;
        room.tx.subscribe()
    }
}

// ---------- per-client session ----------

struct ClientSession {
    client_id: u64,
    identity: String,
    short_id: String,
    name: String,
    transport: String,
    connected_at: u64,
    joined_rooms: Vec<(ChatId, Arc<RwLock<Room>>)>,
}

impl ClientSession {
    fn info(&self) -> ClientInfo {
        ClientInfo {
            id: self.identity.clone(),
            name: self.name.clone(),
            transport: self.transport.clone(),
            connected_at: self.connected_at,
        }
    }
}

// ---------- WebSocket handler ----------

async fn ws_upgrade(ws: WebSocketUpgrade, State(hub): State<Arc<Hub>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, hub))
}

async fn handle_ws(mut socket: WebSocket, hub: Arc<Hub>) {
    let client_id = hub.next_id().await;
    let identity = hex::encode(rand::random::<[u8; 32]>());
    let short_id = identity[..12].to_string();

    let mut session = ClientSession {
        client_id,
        identity: identity.clone(),
        short_id: short_id.clone(),
        name: format!("anon-{}", &short_id[..6]),
        transport: "tcp".into(),
        connected_at: now_ms(),
        joined_rooms: Vec::new(),
    };

    // Send identity
    let _ = send_json(
        &mut socket,
        "identity",
        &serde_json::json!({
            "id": identity,
            "short_id": short_id,
        }),
    )
    .await;

    // If a default display name is configured (from MobileNode callsign),
    // auto-apply it, notify the WebView, and forward to upstream relay
    {
        let default_name = hub.default_display_name.read().await;
        if !default_name.is_empty() {
            session.name = default_name.clone();
            // Tell the WebView what the callsign is so the React store uses it
            let _ = send_json(
                &mut socket,
                "name_assigned",
                &serde_json::json!({
                    "name": *default_name,
                }),
            )
            .await;
            // Forward to upstream relay
            let set_name_msg = make_json(
                "set_name",
                &serde_json::json!({
                    "name": *default_name,
                }),
            );
            let _ = hub.passthrough_tx.send(Arc::new(set_name_msg));
        }
    }

    tracing::info!("client connected: {} ({})", session.name, short_id);

    // Channel for room broadcast messages
    let (fwd_tx, mut fwd_rx) = mpsc::channel::<Arc<String>>(256);

    // Register session for DM delivery
    {
        let mut sessions = hub.active_sessions.write().await;
        sessions.insert(client_id, (identity.clone(), fwd_tx.clone()));
    }
    // Register self as known peer
    {
        let mut peers = hub.known_peers.write().await;
        peers.insert(identity.clone(), session.name.clone());
    }

    // Subscribe to downstream messages from the upstream relay
    let mut downstream_rx = hub.downstream_tx.subscribe();

    loop {
        tokio::select! {
            // Incoming WS message from client
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if !handle_message(&text, &mut session, &hub, &mut socket, &fwd_tx).await {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            // Forwarded broadcast from rooms
            Some(data) = fwd_rx.recv() => {
                if socket.send(Message::Text((*data).clone().into())).await.is_err() {
                    break;
                }
            }
            // Downstream messages from upstream relay (DMs, etc.)
            Ok(data) = downstream_rx.recv() => {
                if socket.send(Message::Text((*data).clone().into())).await.is_err() {
                    break;
                }
            }
        }
    }

    // Unregister session
    {
        let mut sessions = hub.active_sessions.write().await;
        sessions.remove(&session.client_id);
    }

    // If this was a P2P client (wifi-direct), unregister from upstream
    if session.transport == "wifi-direct" {
        let unreg = make_json("unregister_ble_peer", &serde_json::json!({
            "peer_id": session.identity,
        }));
        let _ = hub.passthrough_tx.send(Arc::new(unreg));
    }

    // Cleanup: leave all rooms
    for (chat_id, room_arc) in &session.joined_rooms {
        let mut room = room_arc.write().await;
        room.members.remove(&session.client_id);
        let room_id = chat_id_hex(chat_id);
        let count = room.member_count();
        let msg = make_json(
            "peer_update",
            &serde_json::json!({
                "room_id": room_id,
                "peer_id": session.identity,
                "name": session.name,
                "event": "left",
                "members": count,
            }),
        );
        let _ = room.tx.send(Arc::new(msg));
        broadcast_mesh_state(&room, &room_id);
    }

    tracing::info!("client disconnected: {} ({})", session.name, short_id);
}

async fn handle_message(
    text: &str,
    session: &mut ClientSession,
    hub: &Arc<Hub>,
    socket: &mut WebSocket,
    fwd_tx: &mpsc::Sender<Arc<String>>,
) -> bool {
    let Ok(env) = serde_json::from_str::<WsEnvelope>(text) else {
        let _ = send_json(
            socket,
            "error",
            &serde_json::json!({"message": "invalid JSON"}),
        )
        .await;
        return true;
    };

    match env.r#type.as_str() {
        "set_name" => {
            if let Some(name) = env.data.get("name").and_then(|v| v.as_str()) {
                if !name.is_empty() {
                    session.name = name.to_string();
                    // Update name in all joined rooms
                    for (_, room_arc) in &session.joined_rooms {
                        let mut room = room_arc.write().await;
                        if let Some(info) = room.members.get_mut(&session.client_id) {
                            info.name = name.to_string();
                        }
                    }
                    // Update the Hub's default name so it persists for this session
                    *hub.default_display_name.write().await = name.to_string();
                    // Save to disk so it persists across app restarts
                    if let Some(dir) = hub.data_dir.as_ref() {
                        let path = std::path::Path::new(dir).join("callsign");
                        let _ = std::fs::write(&path, name);
                    }
                    // Update known_peers registry for DM lookup
                    hub.known_peers.write().await.insert(session.identity.clone(), name.to_string());
                    // Forward to upstream relay so it updates our name on the Go server
                    let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
                }
            }
        }

        "join_room" => {
            if let Some(room_name) = env.data.get("name").and_then(|v| v.as_str()) {
                if room_name.is_empty() {
                    return true;
                }
                let room_arc = hub.get_or_create_room(room_name).await;
                let chat_id = chat_id_from_name(room_name);
                let room_id = chat_id_hex(&chat_id);

                // Subscribe to room broadcasts
                let mut rx = {
                    let mut room = room_arc.write().await;
                    room.members.insert(session.client_id, session.info());
                    room.tx.subscribe()
                };

                // Forward broadcast messages, filtering out own
                let fwd = fwd_tx.clone();
                tokio::spawn(async move {
                    while let Ok(msg) = rx.recv().await {
                        if fwd.send(msg).await.is_err() {
                            break;
                        }
                    }
                });

                session.joined_rooms.push((chat_id, room_arc.clone()));

                // Send room_joined
                let room = room_arc.read().await;
                let _ = send_json(
                    socket,
                    "room_joined",
                    &serde_json::json!({
                        "room_id": room_id,
                        "name": room.name,
                        "members": room.member_count(),
                    }),
                )
                .await;

                // Send history
                let _ = send_json(
                    socket,
                    "room_history",
                    &serde_json::json!({
                        "room_id": room_id,
                        "messages": room.messages,
                    }),
                )
                .await;

                // Send voice state
                let voice_state = build_voice_state(&room, &room_id);
                let _ = socket.send(Message::Text(voice_state.into())).await;

                // Send CoT state if any positions exist
                if !room.cot_positions.is_empty() || !room.markers.is_empty() {
                    let contacts: Vec<serde_json::Value> = room.cot_positions.values().cloned().collect();
                    let markers: Vec<serde_json::Value> = room.markers.clone();
                    let _ = send_json(socket, "cot_state", &serde_json::json!({
                        "room_id": room_id,
                        "contacts": contacts,
                        "markers": markers,
                    })).await;
                }

                // Broadcast peer_update to others
                let msg = make_json(
                    "peer_update",
                    &serde_json::json!({
                        "room_id": room_id,
                        "peer_id": session.identity,
                        "name": session.name,
                        "event": "joined",
                        "members": room.member_count(),
                    }),
                );
                let _ = room.tx.send(Arc::new(msg));

                // Broadcast mesh state
                broadcast_mesh_state(&room, &room_id);
            }
        }

        "send_message" => {
            let room_id_str = env
                .data
                .get("room_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = env
                .data
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if content.is_empty() {
                return true;
            }

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let msg = ChatMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    sender: session.identity.clone(),
                    sender_name: session.name.clone(),
                    timestamp: now_ms(),
                    content: content.to_string(),
                    reply_to: env
                        .data
                        .get("reply_to")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                };

                let mut room = room_arc.write().await;
                room.messages.push(msg.clone());
                if room.messages.len() > 1000 {
                    let excess = room.messages.len() - 1000;
                    room.messages.drain(..excess);
                }

                let broadcast = make_json(
                    "message",
                    &serde_json::json!({
                        "room_id": room_id_str,
                        "message": msg,
                    }),
                );
                let _ = room.tx.send(Arc::new(broadcast.clone()));
                // Send to relay channel so the upstream relay forwards it to Go server
                let _ = hub.relay_tx.send(Arc::new(broadcast));
            } else {
                // Room not found locally — forward to upstream (DM rooms, etc.)
                let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
            }
        }

        "set_transport" => {
            if let Some(transport) = env.data.get("transport").and_then(|v| v.as_str()) {
                if !transport.is_empty() {
                    session.transport = transport.to_string();
                    for (_, room_arc) in &session.joined_rooms {
                        let mut room = room_arc.write().await;
                        if let Some(info) = room.members.get_mut(&session.client_id) {
                            info.transport = transport.to_string();
                        }
                    }
                    // If this is a P2P transport (wifi-direct, etc.), register this client
                    // as a peer with the upstream Go server so it appears in mesh state
                    if transport == "wifi-direct" {
                        let reg = make_json("register_ble_peer", &serde_json::json!({
                            "peer_id": session.identity,
                            "peer_name": session.name,
                            "transport": transport,
                        }));
                        let _ = hub.passthrough_tx.send(Arc::new(reg));
                    }
                }
            }
        }

        "create_voice_channel" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let ch_name = env.data.get("name").and_then(|v| v.as_str()).unwrap_or("Voice");
            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let ch_id = uuid::Uuid::new_v4().to_string();
                let mut room = room_arc.write().await;
                room.voice_channels.push(VoiceChannel {
                    id: ch_id.clone(),
                    name: ch_name.to_string(),
                    members: HashMap::new(),
                });
                let msg = make_json("voice_channel_created", &serde_json::json!({
                    "room_id": room_id_str,
                    "channel_id": ch_id,
                    "name": ch_name,
                }));
                let _ = room.tx.send(Arc::new(msg));
            }
            // Also forward upstream
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "join_voice" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let channel_id = env.data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("");
            let sender_id = env.data.get("sender_id").and_then(|v| v.as_str())
                .unwrap_or(&session.identity);
            let sender_name = env.data.get("sender_name").and_then(|v| v.as_str())
                .unwrap_or(&session.name);

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let mut room = room_arc.write().await;
                if let Some(vc) = room.voice_channels.iter_mut().find(|c| c.id == channel_id) {
                    vc.members.insert(sender_id.to_string(), sender_name.to_string());
                }
                // Broadcast voice_peer_joined to room
                let msg = make_json("voice_peer_joined", &serde_json::json!({
                    "room_id": room_id_str,
                    "channel_id": channel_id,
                    "peer_id": sender_id,
                    "name": sender_name,
                }));
                let _ = room.tx.send(Arc::new(msg));
                // Broadcast updated voice_state
                let state = build_voice_state(&room, room_id_str);
                let _ = room.tx.send(Arc::new(state));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
            rebroadcast_ble_control(hub, room_id_str, text).await;
        }

        "leave_voice" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let channel_id = env.data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("");
            let sender_id = env.data.get("sender_id").and_then(|v| v.as_str())
                .unwrap_or(&session.identity);

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let mut room = room_arc.write().await;
                if let Some(vc) = room.voice_channels.iter_mut().find(|c| c.id == channel_id) {
                    vc.members.remove(sender_id);
                }
                let msg = make_json("voice_peer_left", &serde_json::json!({
                    "room_id": room_id_str,
                    "channel_id": channel_id,
                    "peer_id": sender_id,
                }));
                let _ = room.tx.send(Arc::new(msg));
                let state = build_voice_state(&room, room_id_str);
                let _ = room.tx.send(Arc::new(state));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
            rebroadcast_ble_control(hub, room_id_str, text).await;
        }

        "voice_speaking" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let channel_id = env.data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("");
            let peer_id = env.data.get("sender_id").and_then(|v| v.as_str())
                .unwrap_or(&session.identity);
            let speaking = env.data.get("speaking").and_then(|v| v.as_bool()).unwrap_or(false);

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let room = room_arc.read().await;
                let msg = make_json("voice_speaking_broadcast", &serde_json::json!({
                    "room_id": room_id_str,
                    "channel_id": channel_id,
                    "peer_id": peer_id,
                    "speaking": speaking,
                }));
                let _ = room.tx.send(Arc::new(msg));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "voice_offer" | "voice_answer" | "voice_ice" => {
            // Voice signaling: relay to target peer locally
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let _target_id = env.data.get("target_id").and_then(|v| v.as_str()).unwrap_or("");
            let relay_type = match env.r#type.as_str() {
                "voice_offer" => "voice_offer_relay",
                "voice_answer" => "voice_answer_relay",
                "voice_ice" => "voice_ice_relay",
                _ => unreachable!(),
            };

            // Build relay message with from_id
            let relay_msg = make_json(relay_type, &serde_json::json!({
                "room_id": room_id_str,
                "channel_id": env.data.get("channel_id").and_then(|v| v.as_str()).unwrap_or(""),
                "from_id": session.identity,
                "sdp": env.data.get("sdp").unwrap_or(&serde_json::Value::Null),
                "candidate": env.data.get("candidate").unwrap_or(&serde_json::Value::Null),
            }));

            // Find target peer in local rooms and send directly
            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let room = room_arc.read().await;
                // Broadcast to room -- only the target will use it (WebView filters by peer ID)
                let _ = room.tx.send(Arc::new(relay_msg));
            }
            // Also forward upstream for cross-server signaling
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "cot_position" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let sender_id = env.data.get("sender_id").and_then(|v| v.as_str())
                .unwrap_or(&session.identity).to_string();

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let mut room = room_arc.write().await;
                // Store position
                let mut pos_data = env.data.clone();
                if !pos_data.get("sender_id").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false) {
                    pos_data["sender_id"] = serde_json::Value::String(session.identity.clone());
                    pos_data["sender_name"] = serde_json::Value::String(session.name.clone());
                }
                room.cot_positions.insert(sender_id, pos_data);

                // Broadcast cot_state to room
                let contacts: Vec<serde_json::Value> = room.cot_positions.values().cloned().collect();
                let markers: Vec<serde_json::Value> = room.markers.clone();
                let msg = make_json("cot_state", &serde_json::json!({
                    "room_id": room_id_str,
                    "contacts": contacts,
                    "markers": markers,
                }));
                let _ = room.tx.send(Arc::new(msg));
            }
            // Also forward upstream
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "create_marker" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let mut room = room_arc.write().await;
                let mut marker = env.data.clone();
                // Ensure marker has an ID
                if marker.get("marker_id").is_none() || marker.get("marker_id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                    marker["marker_id"] = serde_json::Value::String(uuid::Uuid::new_v4().to_string());
                }
                if !marker.get("creator_id").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false) {
                    marker["creator_id"] = serde_json::Value::String(session.identity.clone());
                    marker["creator_name"] = serde_json::Value::String(session.name.clone());
                }
                room.markers.push(marker.clone());
                let msg = make_json("marker_created", &serde_json::json!({
                    "room_id": room_id_str,
                    "marker": marker,
                }));
                let _ = room.tx.send(Arc::new(msg));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "delete_marker" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let marker_id = env.data.get("marker_id").and_then(|v| v.as_str()).unwrap_or("");

            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let mut room = room_arc.write().await;
                room.markers.retain(|m| m.get("marker_id").and_then(|v| v.as_str()).unwrap_or("") != marker_id);
                let msg = make_json("marker_deleted", &serde_json::json!({
                    "room_id": room_id_str,
                    "marker_id": marker_id,
                }));
                let _ = room.tx.send(Arc::new(msg));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "edit_message" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let msg_id = env.data.get("message_id").and_then(|v| v.as_str()).unwrap_or("");
            let content = env.data.get("content").and_then(|v| v.as_str()).unwrap_or("");

            if !msg_id.is_empty() && !content.is_empty() {
                if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                    let mut room = room_arc.write().await;
                    let edited_at = now_ms();
                    if let Some(msg) = room.messages.iter_mut().find(|m| m.id == msg_id && m.sender == session.identity) {
                        msg.content = content.to_string();
                    }
                    let broadcast = make_json("message_edited", &serde_json::json!({
                        "room_id": room_id_str,
                        "message_id": msg_id,
                        "content": content,
                        "edited_at": edited_at,
                    }));
                    let _ = room.tx.send(Arc::new(broadcast));
                }
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "delete_message" => {
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            let msg_id = env.data.get("message_id").and_then(|v| v.as_str()).unwrap_or("");

            if !msg_id.is_empty() {
                if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                    let mut room = room_arc.write().await;
                    room.messages.retain(|m| !(m.id == msg_id && m.sender == session.identity));
                    let broadcast = make_json("message_deleted", &serde_json::json!({
                        "room_id": room_id_str,
                        "message_id": msg_id,
                    }));
                    let _ = room.tx.send(Arc::new(broadcast));
                }
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "add_reaction" | "remove_reaction" | "pin_message" | "unpin_message" => {
            // Forward to room broadcast so local peers see it, plus upstream
            let room_id_str = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
                let room = room_arc.read().await;
                let _ = room.tx.send(Arc::new(text.to_string()));
            }
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "start_dm" => {
            let target_id = env.data.get("target_id").and_then(|v| v.as_str()).unwrap_or("");
            if target_id.is_empty() {
                return true;
            }

            // Look up target peer name from known_peers registry
            let target_name = {
                let peers = hub.known_peers.read().await;
                peers.get(target_id).cloned().unwrap_or_else(|| format!("anon-{}", &target_id[..target_id.len().min(6)]))
            };

            // Create deterministic DM room name from sorted participant IDs
            let (id1, id2) = if session.identity < target_id.to_string() {
                (session.identity.clone(), target_id.to_string())
            } else {
                (target_id.to_string(), session.identity.clone())
            };
            let dm_room_name = format!("dm:{}:{}", &id1[..id1.len().min(16)], &id2[..id2.len().min(16)]);

            // Check if DM room already exists, or create it
            let room_arc = hub.get_or_create_room(&dm_room_name).await;
            let chat_id = chat_id_from_name(&dm_room_name);
            let room_id = chat_id_hex(&chat_id);

            {
                let mut room = room_arc.write().await;
                room.is_dm = true;
                room.dm_participants = [id1, id2];

                // Add initiator as member if not already
                if !room.members.contains_key(&session.client_id) {
                    room.members.insert(session.client_id, session.info());
                }
            }

            // Track this room in the session
            if !session.joined_rooms.iter().any(|(id, _)| *id == chat_id) {
                // Subscribe to room broadcasts
                let mut rx = {
                    let room = room_arc.read().await;
                    room.tx.subscribe()
                };
                let fwd = fwd_tx.clone();
                tokio::spawn(async move {
                    while let Ok(msg) = rx.recv().await {
                        if fwd.send(msg).await.is_err() { break; }
                    }
                });
                session.joined_rooms.push((chat_id, room_arc.clone()));
            }

            // Send dm_opened to initiator
            let _ = send_json(socket, "dm_opened", &serde_json::json!({
                "room_id": room_id,
                "name": target_name,
                "peer_id": target_id,
                "peer_name": target_name,
            })).await;

            // Send room_joined + history to initiator
            {
                let room = room_arc.read().await;
                let _ = send_json(socket, "room_joined", &serde_json::json!({
                    "room_id": room_id,
                    "name": target_name,
                    "members": room.member_count(),
                    "is_dm": true,
                })).await;
                let _ = send_json(socket, "room_history", &serde_json::json!({
                    "room_id": room_id,
                    "messages": room.messages,
                })).await;
            }

            // Try to notify target if they're a local session
            {
                let sessions = hub.active_sessions.read().await;
                for (_cid, (sid, sender)) in sessions.iter() {
                    if sid == target_id {
                        let dm_opened = make_json("dm_opened", &serde_json::json!({
                            "room_id": room_id,
                            "name": session.name,
                            "peer_id": session.identity,
                            "peer_name": session.name,
                        }));
                        let room_joined = make_json("room_joined", &serde_json::json!({
                            "room_id": room_id,
                            "name": session.name,
                            "members": 2,
                            "is_dm": true,
                        }));
                        let _ = sender.send(Arc::new(dm_opened)).await;
                        let _ = sender.send(Arc::new(room_joined)).await;
                        break;
                    }
                }
            }

            // Also forward upstream so Go server creates its side
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        "join_dm" => {
            let dm_room_id = env.data.get("room_id").and_then(|v| v.as_str()).unwrap_or("");
            if dm_room_id.is_empty() {
                return true;
            }

            if let Some((chat_id, room_arc)) = hub.find_room_by_hex(dm_room_id).await {
                let room_id = chat_id_hex(&chat_id);
                {
                    let mut room = room_arc.write().await;
                    if !room.members.contains_key(&session.client_id) {
                        room.members.insert(session.client_id, session.info());
                    }
                }

                // Subscribe to room broadcasts
                if !session.joined_rooms.iter().any(|(id, _)| *id == chat_id) {
                    let mut rx = {
                        let room = room_arc.read().await;
                        room.tx.subscribe()
                    };
                    let fwd = fwd_tx.clone();
                    tokio::spawn(async move {
                        while let Ok(msg) = rx.recv().await {
                            if fwd.send(msg).await.is_err() { break; }
                        }
                    });
                    session.joined_rooms.push((chat_id, room_arc.clone()));
                }

                let room = room_arc.read().await;
                let peer_name = if room.is_dm {
                    let other = if room.dm_participants[0] == session.identity {
                        &room.dm_participants[1]
                    } else {
                        &room.dm_participants[0]
                    };
                    let peers = hub.known_peers.read().await;
                    peers.get(other).cloned().unwrap_or_else(|| other[..other.len().min(8)].to_string())
                } else {
                    room.name.clone()
                };

                let _ = send_json(socket, "room_joined", &serde_json::json!({
                    "room_id": room_id,
                    "name": peer_name,
                    "members": room.member_count(),
                    "is_dm": room.is_dm,
                })).await;
                let _ = send_json(socket, "room_history", &serde_json::json!({
                    "room_id": room_id,
                    "messages": room.messages,
                })).await;
            }

            // Also forward upstream
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }

        _ => {
            // Forward unrecognized message types to the passthrough channel
            // so the upstream relay can handle them (DMs, voice, CoT, etc.)
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }
    }

    true
}

async fn rebroadcast_ble_control(hub: &Arc<Hub>, room_id_str: &str, raw_text: &str) {
    if room_id_str.is_empty() {
        return;
    }
    if let Some((_, room_arc)) = hub.find_room_by_hex(room_id_str).await {
        let room = room_arc.read().await;
        let _ = room.tx.send(Arc::new(raw_text.to_string()));
    }
}

fn broadcast_mesh_state(room: &Room, room_id: &str) {
    // For each member, send a mesh_state with all OTHER members
    for (cid, _) in &room.members {
        let peers: Vec<serde_json::Value> = room
            .members
            .iter()
            .filter(|(id, _)| *id != cid)
            .map(|(_, info)| {
                serde_json::json!({
                    "id": info.id,
                    "name": info.name,
                    "short_id": if info.id.len() >= 12 { &info.id[..12] } else { &info.id },
                    "transport": info.transport,
                    "latency_ms": 0,
                    "state": "connected",
                    "connected_at": info.connected_at,
                })
            })
            .collect();

        let msg = make_json(
            "mesh_state",
            &serde_json::json!({
                "room_id": room_id,
                "self_id": room.members.get(cid).map(|i| &i.id).unwrap_or(&String::new()),
                "peers": peers,
            }),
        );
        let _ = room.tx.send(Arc::new(msg));
    }
}

async fn send_json(socket: &mut WebSocket, msg_type: &str, data: &serde_json::Value) -> bool {
    let json = make_json(msg_type, data);
    socket.send(Message::Text(json.into())).await.is_ok()
}

pub fn make_json(msg_type: &str, data: &serde_json::Value) -> String {
    serde_json::to_string(&serde_json::json!({
        "type": msg_type,
        "data": data,
    }))
    .unwrap_or_default()
}

fn build_voice_state(room: &Room, room_id: &str) -> String {
    let channels: Vec<serde_json::Value> = room.voice_channels.iter().map(|vc| {
        let members: Vec<serde_json::Value> = vc.members.iter().map(|(id, name)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "short_id": if id.len() >= 12 { &id[..12] } else { id.as_str() },
                "speaking": false,
            })
        }).collect();
        serde_json::json!({
            "id": vc.id,
            "name": vc.name,
            "members": members,
        })
    }).collect();

    make_json("voice_state", &serde_json::json!({
        "room_id": room_id,
        "channels": channels,
    }))
}

// ---------- server startup ----------

pub async fn run_server(
    port: u16,
    web_dir: Option<PathBuf>,
    data_dir: Option<String>,
) -> Result<(u16, Arc<Hub>), String> {
    let hub = Arc::new(Hub::new(data_dir));

    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .layer(CorsLayer::permissive())
        .with_state(hub.clone());

    // Add static file serving if web_dir is provided
    let app = if let Some(dir) = web_dir {
        if dir.exists() {
            tracing::info!("serving web UI from: {}", dir.display());
            app.fallback(axum::routing::get_service(
                tower_http::services::ServeDir::new(dir),
            ))
        } else {
            app
        }
    } else {
        app
    };

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind error: {}", e))?;

    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    tracing::info!("PeatLink mobile server listening on :{}", actual_port);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    Ok((actual_port, hub))
}
