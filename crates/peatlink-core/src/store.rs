use std::sync::Arc;

use anyhow::Result;
use automerge::{transaction::Transactable, ReadDoc};
use peat_mesh::storage::AutomergeStore;

use crate::message::{ChatId, ChatMessage};

/// Collection name prefix for chat rooms in the AutomergeStore.
const CHAT_PREFIX: &str = "chat_";

/// Manages chat room data via peat-mesh's AutomergeStore (Automerge + redb).
pub struct ChatStore {
    store: Arc<AutomergeStore>,
}

impl ChatStore {
    pub fn new(store: Arc<AutomergeStore>) -> Self {
        Self { store }
    }

    /// Get the store key for a chat room's message document.
    fn doc_key(chat_id: &ChatId) -> String {
        format!("{}{}", CHAT_PREFIX, hex::encode(chat_id))
    }

    /// Ensure a chat document exists in the store.
    pub fn ensure_chat(&self, chat_id: &ChatId) -> Result<()> {
        let key = Self::doc_key(chat_id);
        if self.store.get(&key)?.is_none() {
            let mut doc = automerge::AutoCommit::new();
            let _ = doc.put_object(&automerge::ROOT, "messages", automerge::ObjType::List);
            let am = doc.document().clone();
            self.store.put(&key, &am)?;
        }
        Ok(())
    }

    /// Add a message to a chat room. Returns true if the message was new.
    pub fn add_message(&self, chat_id: &ChatId, msg: &ChatMessage) -> Result<bool> {
        let key = Self::doc_key(chat_id);
        self.ensure_chat(chat_id)?;

        let doc_opt = self.store.get(&key)?;
        let Some(existing) = doc_opt else {
            return Ok(false);
        };

        let mut doc = automerge::AutoCommit::load(&existing.save())?;
        let messages_obj = doc
            .get(&automerge::ROOT, "messages")?
            .map(|(_, id)| id)
            .ok_or_else(|| anyhow::anyhow!("no messages list in document"))?;

        // Check for duplicate by scanning existing IDs
        let json = serde_json::to_string(msg)?;
        let msg_id_str = msg.id.to_string();
        let len = doc.length(&messages_obj);
        for i in 0..len {
            if let Ok(Some((val, _))) = doc.get(&messages_obj, i) {
                let raw = format!("{}", val);
                if raw.contains(&msg_id_str) {
                    return Ok(false);
                }
            }
        }

        doc.insert(&messages_obj, len, json)?;
        let am = doc.document().clone();
        self.store.put(&key, &am)?;
        Ok(true)
    }

    /// Get all messages in a chat room.
    pub fn get_messages(&self, chat_id: &ChatId) -> Vec<ChatMessage> {
        let key = Self::doc_key(chat_id);
        let Ok(Some(doc)) = self.store.get(&key) else {
            return Vec::new();
        };

        let fork = automerge::AutoCommit::load(&doc.save()).ok();
        let Some(fork) = fork else {
            return Vec::new();
        };

        let Ok(Some((_, messages_obj))) = fork.get(&automerge::ROOT, "messages") else {
            return Vec::new();
        };

        let mut messages = Vec::new();
        for i in 0..fork.length(&messages_obj) {
            let Ok(Some((val, _))) = fork.get(&messages_obj, i) else {
                continue;
            };
            let raw = format!("{}", val);
            if let Ok(msg) = serde_json::from_str::<ChatMessage>(&raw) {
                messages.push(msg);
            } else {
                let trimmed = raw.trim_matches('"');
                if let Ok(msg) = serde_json::from_str::<ChatMessage>(trimmed) {
                    messages.push(msg);
                }
            }
        }
        messages
    }

    /// Subscribe to store change notifications.
    pub fn subscribe_changes(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.store.subscribe_to_changes()
    }
}
