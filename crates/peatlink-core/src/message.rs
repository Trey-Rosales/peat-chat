use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for a chat room — blake3 hash of the room name.
pub type ChatId = [u8; 32];

/// Derive a deterministic ChatId from a human-readable room name.
pub fn chat_id_from_name(name: &str) -> ChatId {
    *blake3::hash(name.as_bytes()).as_bytes()
}

/// A single chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: Uuid,
    /// Sender's device ID as a string.
    pub sender: String,
    /// Human-readable display name.
    pub sender_name: String,
    /// Unix timestamp in milliseconds.
    pub timestamp: u64,
    /// Message text content.
    pub content: String,
    /// Optional ID of the message being replied to.
    pub reply_to: Option<Uuid>,
}

impl ChatMessage {
    pub fn new(sender: String, sender_name: String, content: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            sender,
            sender_name,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            content,
            reply_to: None,
        }
    }

    /// Format the timestamp as HH:MM:SS (UTC).
    pub fn timestamp_display(&self) -> String {
        let total_secs = self.timestamp / 1000;
        let hours = (total_secs / 3600) % 24;
        let mins = (total_secs / 60) % 60;
        let secs = total_secs % 60;
        format!("{:02}:{:02}:{:02}", hours, mins, secs)
    }
}
