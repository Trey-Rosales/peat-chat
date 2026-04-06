use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use iroh::PublicKey;
use tokio::sync::{broadcast, mpsc, Mutex};

use crate::identity::Identity;
use crate::mesh::{MeshEvent, MeshNetwork};
use crate::message::{chat_id_from_name, ChatId, ChatMessage, WireMessage};
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
        chat_id: ChatId,
    },
    PeerDisconnected {
        peer_id: String,
        chat_id: ChatId,
    },
}

/// The main PeatLink node — backed by peat-mesh identity and iroh-gossip transport.
pub struct PeatLinkNode {
    identity: Identity,
    display_name: String,
    mesh: Arc<Mutex<MeshNetwork>>,
    store: Arc<Mutex<ChatStore>>,
    event_tx: broadcast::Sender<NodeEvent>,
    mesh_event_rx: Option<mpsc::UnboundedReceiver<MeshEvent>>,
}

impl PeatLinkNode {
    /// Create a new node with persistent peat-mesh identity and storage.
    pub async fn new(data_dir: PathBuf, display_name: String) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;

        let identity = Identity::load_or_create(&data_dir.join("identity.key"))?;
        tracing::info!(
            device_id = %identity.device_id_string(),
            iroh_id = %identity.short_id(),
            "loaded peat-mesh identity"
        );

        let (mesh_event_tx, mesh_event_rx) = mpsc::unbounded_channel();
        let mesh = MeshNetwork::new(identity.iroh_secret_key(), mesh_event_tx).await?;

        let store = ChatStore::new(Some(data_dir.join("chats")));
        let (event_tx, _) = broadcast::channel(256);

        Ok(Self {
            identity,
            display_name,
            mesh: Arc::new(Mutex::new(mesh)),
            store: Arc::new(Mutex::new(store)),
            event_tx,
            mesh_event_rx: Some(mesh_event_rx),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NodeEvent> {
        self.event_tx.subscribe()
    }

    /// iroh node ID (for peer addressing).
    pub fn node_id(&self) -> String {
        self.identity.iroh_node_id()
    }

    /// peat-mesh device ID.
    pub fn device_id(&self) -> String {
        self.identity.device_id_string()
    }

    pub fn short_id(&self) -> String {
        self.identity.short_id()
    }

    /// Start the background mesh event processing loop. Call once after creation.
    pub async fn run(&mut self) -> Result<()> {
        let mut mesh_event_rx = self
            .mesh_event_rx
            .take()
            .ok_or_else(|| anyhow::anyhow!("node already running"))?;

        let store = self.store.clone();
        let event_tx = self.event_tx.clone();
        let my_node_id = self.node_id();

        tokio::spawn(async move {
            while let Some(event) = mesh_event_rx.recv().await {
                match event {
                    MeshEvent::MessageReceived { wire_msg, .. } => match wire_msg {
                        WireMessage::Chat { chat_id, message } => {
                            if message.sender == my_node_id {
                                continue;
                            }
                            let mut store = store.lock().await;
                            let added = store.add_message(&chat_id, &message).unwrap_or(false);
                            if added {
                                let _ = store.save_chat(&chat_id);
                                let _ = event_tx.send(NodeEvent::MessageReceived {
                                    chat_id,
                                    message,
                                });
                            }
                        }
                    },
                    MeshEvent::PeerJoined { peer_id, chat_id } => {
                        let _ = event_tx.send(NodeEvent::PeerConnected { peer_id, chat_id });
                    }
                    MeshEvent::PeerLeft { peer_id, chat_id } => {
                        let _ = event_tx.send(NodeEvent::PeerDisconnected { peer_id, chat_id });
                    }
                }
            }
        });

        Ok(())
    }

    /// Join a chat room by name, optionally bootstrapping from known peers.
    pub async fn join_chat(
        &self,
        room_name: &str,
        bootstrap_peers: Vec<PublicKey>,
    ) -> Result<ChatId> {
        let chat_id = chat_id_from_name(room_name);

        {
            let mut store = self.store.lock().await;
            let _ = store.load_chat(&chat_id);
            store.ensure_chat(&chat_id);
        }

        {
            let mut mesh = self.mesh.lock().await;
            mesh.join_topic(chat_id, bootstrap_peers).await?;
        }

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

        {
            let mut store = self.store.lock().await;
            store.add_message(chat_id, &msg)?;
            let _ = store.save_chat(chat_id);
        }

        let wire_msg = WireMessage::Chat {
            chat_id: *chat_id,
            message: msg.clone(),
        };

        {
            let mesh = self.mesh.lock().await;
            mesh.broadcast(chat_id, &wire_msg).await?;
        }

        Ok(msg)
    }

    /// Retrieve all messages in a chat room.
    pub async fn get_messages(&self, chat_id: &ChatId) -> Vec<ChatMessage> {
        let store = self.store.lock().await;
        store.get_messages(chat_id)
    }
}
