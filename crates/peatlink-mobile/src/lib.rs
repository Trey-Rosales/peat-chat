pub mod error;
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
    display_name: String,
    port: RwLock<u16>,
    running: RwLock<bool>,
    runtime: Arc<Runtime>,
    identity: String,

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
            display_name,
            port: RwLock::new(0),
            running: RwLock::new(false),
            runtime: Arc::new(runtime),
            identity,
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
        let actual_port = rt
            .block_on(ws_server::run_server(0, web_path))
            .map_err(|e| PeatLinkError::startup(e))?;

        rt.block_on(async {
            *self.port.write().await = actual_port;
            *self.running.write().await = true;
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
            *self.running.write().await = false;
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
        self.identity.clone()
    }

    pub fn display_name(&self) -> String {
        self.display_name.clone()
    }

    pub fn is_running(&self) -> bool {
        *self.runtime.block_on(self.running.read())
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
