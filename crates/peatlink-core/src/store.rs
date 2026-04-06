use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::Result;
use automerge::{transaction::Transactable, AutoCommit, ObjType, ReadDoc, ROOT};
use uuid::Uuid;

use crate::message::{ChatId, ChatMessage};

/// An Automerge-backed chat document with caches for fast access.
struct ChatDocument {
    doc: AutoCommit,
    message_ids: HashSet<Uuid>,
    messages: Vec<ChatMessage>,
}

impl ChatDocument {
    fn new() -> Self {
        let mut doc = AutoCommit::new();
        let _ = doc.put_object(&ROOT, "messages", ObjType::List);
        Self {
            doc,
            message_ids: HashSet::new(),
            messages: Vec::new(),
        }
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let doc = AutoCommit::load(bytes)?;
        let mut message_ids = HashSet::new();
        let mut messages = Vec::new();
        Self::extract_messages(&doc, &mut message_ids, &mut messages);
        Ok(Self {
            doc,
            message_ids,
            messages,
        })
    }

    fn extract_messages(
        doc: &AutoCommit,
        ids: &mut HashSet<Uuid>,
        msgs: &mut Vec<ChatMessage>,
    ) {
        let Ok(Some((_, messages_obj))) = doc.get(&ROOT, "messages") else {
            return;
        };
        for i in 0..doc.length(&messages_obj) {
            let Ok(Some((val, _))) = doc.get(&messages_obj, i) else {
                continue;
            };
            // Each entry is a JSON-serialized ChatMessage string stored as a scalar.
            // Use the Display impl to get the string content.
            let raw = format!("{}", val);
            // Try parsing directly, or after stripping surrounding quotes
            if let Ok(msg) = serde_json::from_str::<ChatMessage>(&raw) {
                ids.insert(msg.id);
                msgs.push(msg);
            } else {
                let trimmed = raw.trim_matches('"');
                if let Ok(msg) = serde_json::from_str::<ChatMessage>(trimmed) {
                    ids.insert(msg.id);
                    msgs.push(msg);
                }
            }
        }
    }

    fn add_message(&mut self, msg: &ChatMessage) -> Result<bool> {
        if self.message_ids.contains(&msg.id) {
            return Ok(false);
        }

        let json = serde_json::to_string(msg)?;

        let messages_obj = self
            .doc
            .get(&ROOT, "messages")?
            .map(|(_, id)| id)
            .ok_or_else(|| anyhow::anyhow!("no messages list in document"))?;

        let len = self.doc.length(&messages_obj);
        self.doc.insert(&messages_obj, len, json)?;

        self.message_ids.insert(msg.id);
        self.messages.push(msg.clone());
        Ok(true)
    }

    fn get_messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    fn save(&mut self) -> Vec<u8> {
        self.doc.save()
    }
}

/// Manages Automerge documents for all active chats.
pub struct ChatStore {
    chats: HashMap<ChatId, ChatDocument>,
    data_dir: Option<PathBuf>,
}

impl ChatStore {
    pub fn new(data_dir: Option<PathBuf>) -> Self {
        Self {
            chats: HashMap::new(),
            data_dir,
        }
    }

    pub fn load_chat(&mut self, chat_id: &ChatId) -> Result<()> {
        if let Some(ref data_dir) = self.data_dir {
            let path = chat_path(data_dir, chat_id);
            if path.exists() {
                let bytes = std::fs::read(&path)?;
                let chat_doc = ChatDocument::from_bytes(&bytes)?;
                self.chats.insert(*chat_id, chat_doc);
            }
        }
        Ok(())
    }

    pub fn save_chat(&mut self, chat_id: &ChatId) -> Result<()> {
        if let Some(ref data_dir) = self.data_dir {
            if let Some(chat_doc) = self.chats.get_mut(chat_id) {
                std::fs::create_dir_all(data_dir)?;
                let path = chat_path(data_dir, chat_id);
                let bytes = chat_doc.save();
                std::fs::write(path, bytes)?;
            }
        }
        Ok(())
    }

    pub fn ensure_chat(&mut self, chat_id: &ChatId) {
        self.chats
            .entry(*chat_id)
            .or_insert_with(ChatDocument::new);
    }

    pub fn add_message(&mut self, chat_id: &ChatId, msg: &ChatMessage) -> Result<bool> {
        self.ensure_chat(chat_id);
        self.chats.get_mut(chat_id).unwrap().add_message(msg)
    }

    pub fn get_messages(&self, chat_id: &ChatId) -> Vec<ChatMessage> {
        self.chats
            .get(chat_id)
            .map(|d| d.get_messages().to_vec())
            .unwrap_or_default()
    }

    pub fn merge_remote(&mut self, chat_id: &ChatId, remote_bytes: &[u8]) -> Result<()> {
        self.ensure_chat(chat_id);
        let local = self.chats.get_mut(chat_id).unwrap();
        let mut remote = AutoCommit::load(remote_bytes)?;
        local.doc.merge(&mut remote)?;
        local.message_ids.clear();
        local.messages.clear();
        ChatDocument::extract_messages(&local.doc, &mut local.message_ids, &mut local.messages);
        Ok(())
    }
}

fn chat_path(data_dir: &Path, chat_id: &ChatId) -> PathBuf {
    data_dir.join(format!("chat_{}.automerge", hex::encode(chat_id)))
}
