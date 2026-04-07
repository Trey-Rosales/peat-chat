use std::path::Path;

use anyhow::Result;
use peat_mesh::security::{DeviceKeypair, FormationKey};

/// A persistent identity backed by peat-mesh's DeviceKeypair (Ed25519).
pub struct Identity {
    keypair: DeviceKeypair,
}

impl Identity {
    pub fn generate() -> Self {
        Self {
            keypair: DeviceKeypair::generate(),
        }
    }

    /// Load from disk or create and persist a new identity.
    pub fn load_or_create(path: &Path) -> Result<Self> {
        if path.exists() {
            let keypair = DeviceKeypair::load_from_file(path)
                .map_err(|e| anyhow::anyhow!("failed to load identity: {}", e))?;
            Ok(Self { keypair })
        } else {
            let identity = Self::generate();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            identity
                .keypair
                .save_to_file(path)
                .map_err(|e| anyhow::anyhow!("failed to save identity: {}", e))?;
            Ok(identity)
        }
    }

    pub fn keypair(&self) -> &DeviceKeypair {
        &self.keypair
    }

    /// Raw Ed25519 secret key bytes (32 bytes) for seeding iroh within peat-mesh.
    pub fn secret_key_bytes(&self) -> [u8; 32] {
        self.keypair.secret_key_bytes()
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.keypair.public_key_bytes()
    }

    /// String representation of the device ID.
    pub fn device_id_string(&self) -> String {
        format!("{}", self.keypair.device_id())
    }

    /// Shortened device ID for display.
    pub fn short_id(&self) -> String {
        let full = self.device_id_string();
        if full.len() >= 12 {
            full[..12].to_string()
        } else {
            full
        }
    }

    /// Create a FormationKey for a chat room.
    pub fn formation_key(room_name: &str, shared_secret: &[u8; 32]) -> FormationKey {
        FormationKey::new(room_name, shared_secret)
    }
}
