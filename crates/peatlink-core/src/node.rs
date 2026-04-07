use std::path::PathBuf;

use anyhow::Result;
use peat_mesh::mesh::PeatMeshEvent;
use tokio::sync::broadcast;

use crate::identity::Identity;
use crate::mesh::MeshNetwork;
use crate::message::{chat_id_from_name, ChatId, ChatMessage};
use crate::store::ChatStore;

/// Events emitted by the node for the UI/CLI layer.
#[derive(Debug, Clone)]
pub enum NodeEvent {
    Ready {
        node_id: String,
    },
    ChatJoined {
        chat_id: ChatId,
        room_name: String,
    },
    MessageReceived {
        chat_id: ChatId,
        message: ChatMessage,
    },
    PeerConnected {
        peer_id: String,
    },
    PeerDisconnected {
        peer_id: String,
    },
}

/// The main PeatLink node — backed by peat-mesh for identity, networking, and CRDT storage.
pub struct PeatLinkNode {
    identity: Identity,
    display_name: String,
    mesh: MeshNetwork,
    store: ChatStore,
    event_tx: broadcast::Sender<NodeEvent>,
}

impl PeatLinkNode {
    /// Create a new node with persistent peat-mesh identity and storage.
    pub async fn new(data_dir: PathBuf, display_name: String) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;

        let identity = Identity::load_or_create(&data_dir.join("identity.key"))?;
        tracing::info!(
            device_id = %identity.device_id_string(),
            short_id = %identity.short_id(),
            "loaded peat-mesh identity"
        );

        let mesh = MeshNetwork::new(&identity, data_dir).await?;
        let store = ChatStore::new(mesh.store().clone());
        let (event_tx, _) = broadcast::channel(256);

        Ok(Self {
            identity,
            display_name,
            mesh,
            store,
            event_tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NodeEvent> {
        self.event_tx.subscribe()
    }

    /// peat-mesh node ID.
    pub fn node_id(&self) -> String {
        self.mesh.node_id().to_string()
    }

    /// peat-mesh device ID.
    pub fn device_id(&self) -> String {
        self.identity.device_id_string()
    }

    pub fn short_id(&self) -> String {
        self.identity.short_id()
    }

    /// Start the background mesh event processing loop.
    pub async fn run(&mut self) -> Result<()> {
        self.mesh.start()?;

        // Process mesh events (peer join/leave)
        let mut mesh_events = self.mesh.subscribe_events();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            loop {
                match mesh_events.recv().await {
                    Ok(PeatMeshEvent::PeerJoined(node_id)) => {
                        let _ = event_tx.send(NodeEvent::PeerConnected {
                            peer_id: node_id.as_str().to_string(),
                        });
                    }
                    Ok(PeatMeshEvent::PeerLeft(node_id)) => {
                        let _ = event_tx.send(NodeEvent::PeerDisconnected {
                            peer_id: node_id.as_str().to_string(),
                        });
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("mesh event receiver lagged by {}", n);
                    }
                    Err(_) => break,
                }
            }
        });

        // Process store changes (new messages from remote sync)
        let mut store_changes = self.store.subscribe_changes();
        let store_ref = ChatStore::new(self.mesh.store().clone());
        let event_tx2 = self.event_tx.clone();
        let my_node_id = self.node_id();

        tokio::spawn(async move {
            loop {
                match store_changes.recv().await {
                    Ok(key) => {
                        if key.starts_with("chat_") {
                            // A chat document changed — check for new messages
                            // The key is "chat_{hex_chat_id}"
                            if let Ok(chat_id_bytes) = hex::decode(key.trim_start_matches("chat_"))
                            {
                                if chat_id_bytes.len() == 32 {
                                    let mut chat_id = [0u8; 32];
                                    chat_id.copy_from_slice(&chat_id_bytes);
                                    let messages = store_ref.get_messages(&chat_id);
                                    // Emit the latest message if it's from someone else
                                    if let Some(msg) = messages.last() {
                                        if msg.sender != my_node_id {
                                            let _ =
                                                event_tx2.send(NodeEvent::MessageReceived {
                                                    chat_id,
                                                    message: msg.clone(),
                                                });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(_) => break,
                }
            }
        });

        let _ = self.event_tx.send(NodeEvent::Ready {
            node_id: self.node_id(),
        });

        Ok(())
    }

    /// Join a chat room by name.
    pub async fn join_chat(&self, room_name: &str) -> Result<ChatId> {
        let chat_id = chat_id_from_name(room_name);

        self.store.ensure_chat(&chat_id)?;

        let _ = self.event_tx.send(NodeEvent::ChatJoined {
            chat_id,
            room_name: room_name.to_string(),
        });

        Ok(chat_id)
    }

    /// Send a text message to a chat room.
    pub async fn send_message(
        &self,
        chat_id: &ChatId,
        content: String,
    ) -> Result<ChatMessage> {
        let msg = ChatMessage::new(self.node_id(), self.display_name.clone(), content);

        self.store.add_message(chat_id, &msg)?;

        Ok(msg)
    }

    /// Retrieve all messages in a chat room.
    pub async fn get_messages(&self, chat_id: &ChatId) -> Vec<ChatMessage> {
        self.store.get_messages(chat_id)
    }
}
