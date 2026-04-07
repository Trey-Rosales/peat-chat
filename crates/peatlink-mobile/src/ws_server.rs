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
                }
            }
        }

        _ => {
            // Forward unrecognized message types to the passthrough channel
            // so the upstream relay can handle them (DMs, voice, CoT, etc.)
            let _ = hub.passthrough_tx.send(Arc::new(text.to_string()));
        }
    }

    true
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
