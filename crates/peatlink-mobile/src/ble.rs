//! BLE mesh transport integration via peat-btle.
//!
//! peat-btle's PeatMesh is a synchronous state machine:
//! - Platform pushes BLE events in (discovered, connected, data_received)
//! - PeatMesh processes them and returns data to send out
//! - Periodic `tick()` drives heartbeats and sync

use std::sync::Arc;

use peat_btle::observer::{PeatEvent, PeatObserver};
use peat_btle::peat_mesh::{PeatMesh, PeatMeshConfig};
use peat_btle::peer::PeatPeer;
use peat_btle::PeatDisconnectReason as DisconnectReason;
use peat_btle::DeviceIdentity;
use peat_btle::NodeId;
use tokio::sync::{mpsc, RwLock};

use crate::error::PeatLinkError;

/// BLE peer info for the mesh viewer.
#[derive(Debug, Clone)]
pub struct BlePeerInfo {
    pub id: String,
    pub name: String,
    pub rssi: i8,
    pub is_connected: bool,
    pub last_seen_ms: u64,
    pub transport: String,
}

/// Events from the BLE mesh bridged to the WS server.
#[derive(Debug, Clone)]
pub enum BlePeerEvent {
    PeerConnected(BlePeerInfo),
    PeerDisconnected(BlePeerInfo),
}

/// Observer that bridges peat-btle events to our channel.
struct ChatObserver {
    event_tx: mpsc::UnboundedSender<BlePeerEvent>,
}

impl PeatObserver for ChatObserver {
    fn on_event(&self, event: PeatEvent) {
        match event {
            PeatEvent::PeerConnected { node_id } => {
                let _ = self.event_tx.send(BlePeerEvent::PeerConnected(BlePeerInfo {
                    id: format!("{}", node_id),
                    name: format!("BLE-{}", node_id),
                    rssi: 0,
                    is_connected: true,
                    last_seen_ms: 0,
                    transport: "btle".to_string(),
                }));
            }
            PeatEvent::PeerDisconnected { node_id, .. } => {
                let _ = self.event_tx.send(BlePeerEvent::PeerDisconnected(BlePeerInfo {
                    id: format!("{}", node_id),
                    name: format!("BLE-{}", node_id),
                    rssi: 0,
                    is_connected: false,
                    last_seen_ms: 0,
                    transport: "btle".to_string(),
                }));
            }
            _ => {}
        }
    }
}

pub struct BleMeshConfig {
    pub mesh_id: String,
    pub callsign: String,
    pub shared_secret: Option<Vec<u8>>,
}

/// Manages the peat-btle mesh state machine.
pub struct BleManager {
    mesh: RwLock<Option<PeatMesh>>,
    running: RwLock<bool>,
    event_tx: mpsc::UnboundedSender<BlePeerEvent>,
}

impl BleManager {
    pub fn new(event_tx: mpsc::UnboundedSender<BlePeerEvent>) -> Self {
        Self {
            mesh: RwLock::new(None),
            running: RwLock::new(false),
            event_tx,
        }
    }

    pub async fn start(&self, config: BleMeshConfig) -> Result<(), PeatLinkError> {
        let mut running = self.running.write().await;
        if *running {
            return Err(PeatLinkError::AlreadyRunning);
        }

        tracing::info!(mesh_id = %config.mesh_id, "starting BLE mesh");

        let identity = DeviceIdentity::generate();
        let node_id = NodeId::from(rand::random::<u32>());

        let mut mesh_config = PeatMeshConfig::new(node_id, &config.callsign, &config.mesh_id)
            .with_sync_interval(5000)
            .with_relay();

        if let Some(secret) = &config.shared_secret {
            let mut key = [0u8; 32];
            let len = secret.len().min(32);
            key[..len].copy_from_slice(&secret[..len]);
            mesh_config = mesh_config.with_encryption(key);
        }

        let mesh = PeatMesh::with_identity(mesh_config, identity);

        // Register observer for peer events
        let observer = Arc::new(ChatObserver {
            event_tx: self.event_tx.clone(),
        });
        mesh.add_observer(observer);

        *self.mesh.write().await = Some(mesh);
        *running = true;

        tracing::info!("BLE mesh started (node_id: {})", node_id);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), PeatLinkError> {
        let mut running = self.running.write().await;
        if !*running {
            return Err(PeatLinkError::NotRunning);
        }
        *self.mesh.write().await = None;
        *running = false;
        tracing::info!("BLE mesh stopped");
        Ok(())
    }

    pub async fn peers(&self) -> Vec<BlePeerInfo> {
        let mesh = self.mesh.read().await;
        match mesh.as_ref() {
            Some(m) => m.get_peers().into_iter().map(|p| peer_to_info(&p)).collect(),
            None => Vec::new(),
        }
    }

    /// Send a chat message via BLE mesh. Returns encrypted document to broadcast.
    pub async fn send_chat(&self, sender: &str, text: &str, timestamp: u64) -> Option<Vec<u8>> {
        let mesh = self.mesh.read().await;
        mesh.as_ref()?.send_chat(sender, text, timestamp)
    }

    /// Get all chat messages received via BLE.
    /// Returns (sender_node_id, timestamp, sender_name, content, reply_to_node, reply_to_ts).
    pub async fn chat_messages(&self) -> Vec<(u32, u64, String, String, u32, u64)> {
        let mesh = self.mesh.read().await;
        match mesh.as_ref() {
            Some(m) => m.all_chat_messages(),
            None => Vec::new(),
        }
    }

    // --- Platform BLE callbacks ---

    pub async fn on_ble_discovered(
        &self,
        identifier: &str,
        name: Option<&str>,
        rssi: i8,
        mesh_id: Option<&str>,
        now_ms: u64,
    ) {
        let mesh = self.mesh.read().await;
        if let Some(m) = mesh.as_ref() {
            m.on_ble_discovered(identifier, name, rssi, mesh_id, now_ms);
        }
    }

    pub async fn on_ble_connected(&self, identifier: &str, now_ms: u64) -> Option<u32> {
        let mesh = self.mesh.read().await;
        mesh.as_ref()?
            .on_ble_connected(identifier, now_ms)
            .map(|n| u32::from(n))
    }

    pub async fn on_ble_disconnected(&self, identifier: &str) {
        let mesh = self.mesh.read().await;
        if let Some(m) = mesh.as_ref() {
            m.on_ble_disconnected(identifier, DisconnectReason::LocalRequest);
        }
    }

    pub async fn on_ble_data_received(&self, identifier: &str, data: &[u8], now_ms: u64) {
        let mesh = self.mesh.read().await;
        if let Some(m) = mesh.as_ref() {
            m.on_ble_data_received(identifier, data, now_ms);
        }
    }

    /// Periodic tick. Returns data to broadcast via BLE if any.
    pub async fn tick(&self, now_ms: u64) -> Option<Vec<u8>> {
        let mesh = self.mesh.read().await;
        mesh.as_ref()?.tick(now_ms)
    }

    pub async fn build_document(&self) -> Option<Vec<u8>> {
        let mesh = self.mesh.read().await;
        Some(mesh.as_ref()?.build_document())
    }

    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }
}

fn peer_to_info(peer: &PeatPeer) -> BlePeerInfo {
    BlePeerInfo {
        id: format!("{}", peer.node_id),
        name: peer
            .name
            .clone()
            .unwrap_or_else(|| peer.display_name().to_string()),
        rssi: peer.rssi,
        is_connected: peer.is_connected,
        last_seen_ms: peer.last_seen_ms,
        transport: "btle".to_string(),
    }
}
