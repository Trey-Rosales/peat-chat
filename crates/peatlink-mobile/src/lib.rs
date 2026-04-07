pub mod error;
pub mod upstream_relay;
pub mod ws_server;

#[cfg(feature = "bluetooth")]
pub mod ble;
#[cfg(feature = "bluetooth")]
pub mod bridge;

use std::path::PathBuf;
use std::sync::Arc;

use error::PeatLinkError;
use tokio::runtime::Runtime;
use tokio::sync::RwLock;

uniffi::include_scaffolding!("peatlink_mobile");

pub fn peatlink_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// BLE peer info exposed via UniFFI.
#[derive(Debug, Clone)]
pub struct BlePeerInfo {
    pub id: String,
    pub name: String,
    pub rssi: i8,
    pub is_connected: bool,
    pub last_seen_ms: u64,
    pub transport: String,
}

/// Opus audio frame for BLE voice relay.
#[derive(Debug, Clone)]
pub struct VoiceFrame {
    pub data: Vec<u8>,
    pub sender_id: String,
    pub sender_name: String,
    pub timestamp: u64,
}

pub struct MobileNode {
    data_dir: String,
    display_name: RwLock<String>,
    port: RwLock<u16>,
    running: RwLock<bool>,
    runtime: Arc<Runtime>,
    identity: RwLock<String>,
    hub: RwLock<Option<Arc<ws_server::Hub>>>,
    upstream_handle: RwLock<Option<upstream_relay::UpstreamRelayHandle>>,
    seen_ids: upstream_relay::SeenIds,

    /// Outgoing voice frames (Kotlin → bridge → BLE)
    voice_outgoing_tx: tokio::sync::mpsc::UnboundedSender<VoiceFrame>,
    voice_outgoing_rx: RwLock<Option<tokio::sync::mpsc::UnboundedReceiver<VoiceFrame>>>,
    /// Incoming voice frames (BLE → bridge → Kotlin)
    voice_incoming_tx: tokio::sync::mpsc::UnboundedSender<VoiceFrame>,
    voice_incoming_rx: RwLock<tokio::sync::mpsc::UnboundedReceiver<VoiceFrame>>,

    #[cfg(feature = "bluetooth")]
    ble_manager: Arc<ble::BleManager>,
    #[cfg(feature = "bluetooth")]
    ble_event_rx: RwLock<Option<tokio::sync::mpsc::UnboundedReceiver<ble::BlePeerEvent>>>,
    #[cfg(feature = "bluetooth")]
    bridge_handle: RwLock<Option<bridge::BridgeHandle>>,
}

impl MobileNode {
    pub fn new(data_dir: String, display_name: String) -> Result<Self, PeatLinkError> {
        let runtime = Runtime::new().map_err(|e| PeatLinkError::startup(e))?;
        let identity = hex::encode(rand::random::<[u8; 32]>());

        std::fs::create_dir_all(&data_dir)
            .map_err(|e| PeatLinkError::startup(format!("create data dir: {}", e)))?;

        #[cfg(feature = "bluetooth")]
        let (ble_event_tx, ble_event_rx) = tokio::sync::mpsc::unbounded_channel();
        #[cfg(feature = "bluetooth")]
        let ble_manager = Arc::new(ble::BleManager::new(ble_event_tx));

        let (voice_outgoing_tx, voice_outgoing_rx) = tokio::sync::mpsc::unbounded_channel();
        let (voice_incoming_tx, voice_incoming_rx) = tokio::sync::mpsc::unbounded_channel();

        Ok(Self {
            data_dir,
            display_name: RwLock::new(display_name),
            port: RwLock::new(0),
            running: RwLock::new(false),
            runtime: Arc::new(runtime),
            identity: RwLock::new(identity),
            hub: RwLock::new(None),
            upstream_handle: RwLock::new(None),
            seen_ids: upstream_relay::new_seen_ids(),
            voice_outgoing_tx,
            voice_outgoing_rx: RwLock::new(Some(voice_outgoing_rx)),
            voice_incoming_tx,
            voice_incoming_rx: RwLock::new(voice_incoming_rx),
            #[cfg(feature = "bluetooth")]
            ble_manager,
            #[cfg(feature = "bluetooth")]
            bridge_handle: RwLock::new(None),
            #[cfg(feature = "bluetooth")]
            ble_event_rx: RwLock::new(Some(ble_event_rx)),
        })
    }

    /// Start the embedded HTTP/WS server. Returns the actual port.
    pub fn start(&self, web_dir: Option<String>) -> Result<u16, PeatLinkError> {
        let rt = self.runtime.clone();

        {
            let running = rt.block_on(self.running.read());
            if *running {
                return Err(PeatLinkError::AlreadyRunning);
            }
        }

        let web_path = web_dir.map(PathBuf::from);
        let (actual_port, hub) = rt
            .block_on(ws_server::run_server(0, web_path, Some(self.data_dir.clone())))
            .map_err(|e| PeatLinkError::startup(e))?;

        rt.block_on(async {
            // Check for a persisted callsign from a previous session
            let callsign_path = std::path::Path::new(&self.data_dir).join("callsign");
            if let Ok(saved) = std::fs::read_to_string(&callsign_path) {
                let saved = saved.trim().to_string();
                if !saved.is_empty() {
                    *self.display_name.write().await = saved.clone();
                    *hub.default_display_name.write().await = saved;
                }
            } else {
                // Use the MobileNode's display name (from Android prefs)
                let name = self.display_name.read().await.clone();
                if !name.is_empty() {
                    *hub.default_display_name.write().await = name;
                }
            }
            *self.port.write().await = actual_port;
            *self.running.write().await = true;
            *self.hub.write().await = Some(hub);
        });

        Ok(actual_port)
    }

    pub fn stop(&self) -> Result<(), PeatLinkError> {
        let rt = self.runtime.clone();
        let running = rt.block_on(self.running.read());
        if !*running {
            return Err(PeatLinkError::NotRunning);
        }
        rt.block_on(async {
            // Stop upstream relay if running
            if let Some(handle) = self.upstream_handle.write().await.take() {
                handle.shutdown().await;
            }
            *self.running.write().await = false;
            *self.hub.write().await = None;
        });
        // Also stop BLE if running
        #[cfg(feature = "bluetooth")]
        {
            let _ = rt.block_on(self.ble_manager.stop());
        }
        Ok(())
    }

    pub fn port(&self) -> u16 {
        *self.runtime.block_on(self.port.read())
    }

    pub fn node_id(&self) -> String {
        self.runtime.block_on(self.identity.read()).clone()
    }

    pub fn display_name(&self) -> String {
        self.runtime.block_on(self.display_name.read()).clone()
    }

    pub fn is_running(&self) -> bool {
        *self.runtime.block_on(self.running.read())
    }

    // --- Settings ---

    /// Update the display name. Also propagates to Hub and upstream relay.
    pub fn set_display_name(&self, name: String) {
        self.runtime.block_on(async {
            *self.display_name.write().await = name.clone();
            // Update the Hub's default name so new connections get it
            if let Some(hub) = self.hub.read().await.as_ref() {
                *hub.default_display_name.write().await = name.clone();
                // Send set_name via passthrough to update upstream relay
                let msg = ws_server::make_json("set_name", &serde_json::json!({"name": name}));
                let _ = hub.passthrough_tx.send(std::sync::Arc::new(msg));
            }
        });
    }

    /// Regenerate identity (new random ID).
    pub fn regenerate_identity(&self) -> String {
        let new_id = hex::encode(rand::random::<[u8; 32]>());
        self.runtime.block_on(async {
            *self.identity.write().await = new_id.clone();
        });
        new_id
    }

    // --- Upstream relay ---

    /// Connect to an upstream Go server for message relay.
    pub fn connect_upstream(&self, url: String, room_name: String) -> Result<(), PeatLinkError> {
        let rt = self.runtime.clone();

        let hub = rt.block_on(self.hub.read()).clone();
        let hub = hub.ok_or_else(|| {
            PeatLinkError::startup("server not running — call start() first")
        })?;

        let display_name = rt.block_on(self.display_name.read()).clone();

        let handle = rt
            .block_on(upstream_relay::start_upstream_relay(
                url,
                hub,
                display_name,
                room_name,
                self.seen_ids.clone(),
            ))
            .map_err(|e| PeatLinkError::startup(e))?;

        rt.block_on(async {
            *self.upstream_handle.write().await = Some(handle);
        });

        Ok(())
    }

    /// Disconnect from the upstream relay.
    pub fn disconnect_upstream(&self) -> Result<(), PeatLinkError> {
        let rt = self.runtime.clone();
        rt.block_on(async {
            if let Some(handle) = self.upstream_handle.write().await.take() {
                handle.shutdown().await;
            }
        });
        Ok(())
    }

    /// Whether the upstream relay is currently connected.
    pub fn is_upstream_connected(&self) -> bool {
        let rt = self.runtime.clone();
        rt.block_on(async {
            if let Some(handle) = self.upstream_handle.read().await.as_ref() {
                handle.is_connected().await
            } else {
                false
            }
        })
    }

    // --- BLE mesh controls ---

    /// Start the BLE mesh transport for peer-to-peer communication.
    /// If the WS server is running, also starts the BLE ↔ WS bridge.
    pub fn start_ble(
        &self,
        mesh_id: String,
        callsign: String,
        shared_secret: Option<Vec<u8>>,
    ) -> Result<(), PeatLinkError> {
        #[cfg(feature = "bluetooth")]
        {
            let config = ble::BleMeshConfig {
                mesh_id,
                callsign,
                shared_secret,
            };
            self.runtime.block_on(self.ble_manager.start(config))?;

            // Start the BLE ↔ WS bridge if the Hub is available
            self.runtime.block_on(async {
                if let Some(hub) = self.hub.read().await.clone() {
                    if let Some(event_rx) = self.ble_event_rx.write().await.take() {
                        let node_id = self.identity.read().await.clone();
                        let voice_rx = self.voice_outgoing_rx.write().await.take();
                        let handle = bridge::start_bridge(
                            hub,
                            self.ble_manager.clone(),
                            event_rx,
                            "general".to_string(),
                            self.seen_ids.clone(),
                            node_id,
                            voice_rx.unwrap_or_else(|| {
                                tokio::sync::mpsc::unbounded_channel().1
                            }),
                            self.voice_incoming_tx.clone(),
                        )
                        .await;
                        *self.bridge_handle.write().await = Some(handle);
                        tracing::info!("BLE↔WS bridge started");
                    }
                }
            });

            Ok(())
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            let _ = (mesh_id, callsign, shared_secret);
            Err(PeatLinkError::startup(
                "BLE support not compiled in. Rebuild with --features bluetooth",
            ))
        }
    }

    /// Stop the BLE mesh transport and bridge.
    pub fn stop_ble(&self) -> Result<(), PeatLinkError> {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime.block_on(async {
                if let Some(handle) = self.bridge_handle.write().await.take() {
                    handle.shutdown().await;
                }
            });
            self.runtime.block_on(self.ble_manager.stop())
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            Err(PeatLinkError::NotRunning)
        }
    }

    /// Whether the BLE mesh is currently running.
    pub fn is_ble_running(&self) -> bool {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime.block_on(self.ble_manager.is_running())
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            false
        }
    }

    /// Get currently known BLE mesh peers.
    pub fn ble_peers(&self) -> Vec<BlePeerInfo> {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime
                .block_on(self.ble_manager.peers())
                .into_iter()
                .map(|p| BlePeerInfo {
                    id: p.id,
                    name: p.name,
                    rssi: p.rssi,
                    is_connected: p.is_connected,
                    last_seen_ms: p.last_seen_ms,
                    transport: p.transport,
                })
                .collect()
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            Vec::new()
        }
    }

    // --- BLE platform callbacks (called from Android/iOS native code) ---

    pub fn on_ble_discovered(
        &self,
        identifier: String,
        name: Option<String>,
        rssi: i8,
        mesh_id: Option<String>,
        now_ms: u64,
    ) {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime.block_on(self.ble_manager.on_ble_discovered(
                &identifier,
                name.as_deref(),
                rssi,
                mesh_id.as_deref(),
                now_ms,
            ));
        }
    }

    pub fn on_ble_connected(&self, identifier: String, now_ms: u64) {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime
                .block_on(self.ble_manager.on_ble_connected(&identifier, now_ms));
        }
    }

    pub fn on_ble_disconnected(&self, identifier: String) {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime
                .block_on(self.ble_manager.on_ble_disconnected(&identifier));
        }
    }

    pub fn on_ble_data_received(&self, identifier: String, data: Vec<u8>, now_ms: u64) {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime
                .block_on(self.ble_manager.on_ble_data_received(&identifier, &data, now_ms));
        }
    }

    /// Periodic BLE tick. Returns data to broadcast to connected peers, if any.
    pub fn ble_tick(&self, now_ms: u64) -> Option<Vec<u8>> {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime.block_on(self.ble_manager.tick(now_ms))
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            let _ = now_ms;
            None
        }
    }

    /// Build current mesh document for new connections.
    pub fn ble_build_document(&self) -> Option<Vec<u8>> {
        #[cfg(feature = "bluetooth")]
        {
            self.runtime.block_on(self.ble_manager.build_document())
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            None
        }
    }

    // --- BLE voice audio relay ---

    /// Send an Opus-encoded audio frame over BLE mesh.
    /// Called by Kotlin when the user is transmitting (PTT pressed).
    pub fn send_voice_frame(&self, opus_frame: Vec<u8>, sender_id: String, sender_name: String) {
        let frame = VoiceFrame {
            data: opus_frame,
            sender_id,
            sender_name,
            timestamp: ws_server::now_ms(),
        };
        let _ = self.voice_outgoing_tx.send(frame);
    }

    /// Receive all pending voice frames from BLE peers.
    /// Called by Kotlin to get audio data for playback.
    pub fn recv_voice_frames(&self) -> Vec<VoiceFrame> {
        let mut frames = Vec::new();
        let rt = self.runtime.clone();
        rt.block_on(async {
            let mut rx = self.voice_incoming_rx.write().await;
            while let Ok(frame) = rx.try_recv() {
                frames.push(frame);
            }
        });
        frames
    }
}
