use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use peat_mesh::config::{IrohConfig, MeshConfig, MeshDiscoveryConfig};
use peat_mesh::mesh::{PeatMesh, PeatMeshBuilder, PeatMeshEvent};
use peat_mesh::storage::AutomergeStore;
use tokio::sync::broadcast;

use crate::identity::Identity;

/// Wraps PeatMesh, AutomergeStore, and sync infrastructure.
pub struct MeshNetwork {
    mesh: PeatMesh,
    store: Arc<AutomergeStore>,
}

impl MeshNetwork {
    /// Create a new mesh network backed by peat-mesh.
    pub async fn new(identity: &Identity, data_dir: PathBuf) -> Result<Self> {
        let store_path = data_dir.join("peat-store");
        std::fs::create_dir_all(&store_path)?;

        // Open persistent AutomergeStore
        let store = Arc::new(
            AutomergeStore::open(&store_path)
                .map_err(|e| anyhow::anyhow!("failed to open store: {}", e))?,
        );

        // Configure peat-mesh with our identity's key seed
        let config = MeshConfig {
            node_id: Some(identity.device_id_string()),
            storage_path: Some(data_dir.clone()),
            discovery: MeshDiscoveryConfig {
                mdns_enabled: true,
                service_name: "peatlink".to_string(),
                ..Default::default()
            },
            iroh: IrohConfig {
                secret_key: Some(identity.secret_key_bytes()),
                ..Default::default()
            },
            ..Default::default()
        };

        let mesh = PeatMeshBuilder::new(config)
            .with_device_keypair(identity.keypair().clone())
            .build();

        Ok(Self { mesh, store })
    }

    /// Start the mesh network.
    pub fn start(&self) -> Result<()> {
        self.mesh
            .start()
            .map_err(|e| anyhow::anyhow!("mesh start failed: {}", e))
    }

    /// Stop the mesh network.
    pub fn stop(&self) -> Result<()> {
        self.mesh
            .stop()
            .map_err(|e| anyhow::anyhow!("mesh stop failed: {}", e))
    }

    /// Get the node ID.
    pub fn node_id(&self) -> &str {
        self.mesh.node_id()
    }

    /// Subscribe to mesh events (peer join/leave, state changes).
    pub fn subscribe_events(&self) -> broadcast::Receiver<PeatMeshEvent> {
        self.mesh.subscribe_events()
    }

    /// Get a reference to the AutomergeStore for CRDT operations.
    pub fn store(&self) -> &Arc<AutomergeStore> {
        &self.store
    }
}
