use std::collections::HashMap;

use anyhow::Result;
use bytes::Bytes;
use futures_util::StreamExt;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_gossip::api::{Event, GossipSender};
use iroh_gossip::net::Gossip;
use iroh_gossip::proto::TopicId;
use tokio::sync::mpsc;

use crate::message::{ChatId, WireMessage};

/// Events emitted by the mesh networking layer.
pub enum MeshEvent {
    MessageReceived {
        from: String,
        wire_msg: WireMessage,
    },
    PeerJoined {
        peer_id: String,
        chat_id: ChatId,
    },
    PeerLeft {
        peer_id: String,
        chat_id: ChatId,
    },
}

/// Manages the iroh P2P endpoint, gossip protocol, and connection router.
pub struct MeshNetwork {
    endpoint: Endpoint,
    gossip: Gossip,
    _router: Router,
    senders: HashMap<ChatId, GossipSender>,
    event_tx: mpsc::UnboundedSender<MeshEvent>,
}

impl MeshNetwork {
    pub async fn new(
        secret_key: SecretKey,
        event_tx: mpsc::UnboundedSender<MeshEvent>,
    ) -> Result<Self> {
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .bind()
            .await?;

        let gossip = Gossip::builder().spawn(endpoint.clone());

        // Router dispatches incoming connections to the gossip protocol handler
        let router = Router::builder(endpoint.clone())
            .accept(iroh_gossip::ALPN, gossip.clone())
            .spawn();

        Ok(Self {
            endpoint,
            gossip,
            _router: router,
            senders: HashMap::new(),
            event_tx,
        })
    }

    pub fn node_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    pub fn endpoint_addr(&self) -> EndpointAddr {
        self.endpoint.addr()
    }

    /// Join a gossip topic for a chat room.
    pub async fn join_topic(
        &mut self,
        chat_id: ChatId,
        bootstrap_peers: Vec<PublicKey>,
    ) -> Result<()> {
        let topic_id = TopicId::from_bytes(chat_id);

        let topic = self
            .gossip
            .subscribe_and_join(topic_id, bootstrap_peers)
            .await?;

        let (sender, receiver) = topic.split();

        // Spawn task to process incoming gossip events
        let event_tx = self.event_tx.clone();
        let cid = chat_id;
        tokio::spawn(async move {
            let mut receiver = receiver;
            while let Some(event) = receiver.next().await {
                match event {
                    Ok(Event::Received(msg)) => {
                        if let Ok(wire_msg) =
                            postcard::from_bytes::<WireMessage>(&msg.content)
                        {
                            let _ = event_tx.send(MeshEvent::MessageReceived {
                                from: msg.delivered_from.to_string(),
                                wire_msg,
                            });
                        }
                    }
                    Ok(Event::NeighborUp(id)) => {
                        let _ = event_tx.send(MeshEvent::PeerJoined {
                            peer_id: id.to_string(),
                            chat_id: cid,
                        });
                    }
                    Ok(Event::NeighborDown(id)) => {
                        let _ = event_tx.send(MeshEvent::PeerLeft {
                            peer_id: id.to_string(),
                            chat_id: cid,
                        });
                    }
                    Ok(Event::Lagged) => {
                        tracing::warn!("gossip receiver lagged on topic");
                    }
                    Err(e) => {
                        tracing::error!("gossip stream error: {}", e);
                        break;
                    }
                }
            }
        });

        self.senders.insert(chat_id, sender);
        Ok(())
    }

    /// Broadcast a wire message to all peers in a chat topic.
    pub async fn broadcast(&self, chat_id: &ChatId, msg: &WireMessage) -> Result<()> {
        let sender = self
            .senders
            .get(chat_id)
            .ok_or_else(|| anyhow::anyhow!("not subscribed to this chat topic"))?;

        let bytes = postcard::to_allocvec(msg)?;
        sender.broadcast(Bytes::from(bytes)).await?;
        Ok(())
    }
}
