pub mod error;
pub mod upstream_relay;
pub mod ws_server;

#[cfg(feature = "bluetooth")]
pub mod ble;

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

    #[cfg(feature = "bluetooth")]
    ble_manager: Arc<ble::BleManager>,
    #[cfg(feature = "bluetooth")]
    _ble_event_rx: RwLock<Option<tokio::sync::mpsc::UnboundedReceiver<ble::BlePeerEvent>>>,
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
            #[cfg(feature = "bluetooth")]
            ble_manager,
            #[cfg(feature = "bluetooth")]
            _ble_event_rx: RwLock::new(Some(ble_event_rx)),
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
            self.runtime.block_on(self.ble_manager.start(config))
        }
        #[cfg(not(feature = "bluetooth"))]
        {
            let _ = (mesh_id, callsign, shared_secret);
            Err(PeatLinkError::startup(
                "BLE support not compiled in. Rebuild with --features bluetooth",
            ))
        }
    }

    /// Stop the BLE mesh transport.
    pub fn stop_ble(&self) -> Result<(), PeatLinkError> {
        #[cfg(feature = "bluetooth")]
        {
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
}
