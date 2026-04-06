use std::fmt;

#[derive(Debug, thiserror::Error)]
pub enum PeatLinkError {
    #[error("startup error: {msg}")]
    StartupError { msg: String },
    #[error("node is already running")]
    AlreadyRunning,
    #[error("node is not running")]
    NotRunning,
    #[error("internal error: {msg}")]
    InternalError { msg: String },
}

impl PeatLinkError {
    pub fn startup(msg: impl fmt::Display) -> Self {
        Self::StartupError { msg: msg.to_string() }
    }

    pub fn internal(msg: impl fmt::Display) -> Self {
        Self::InternalError { msg: msg.to_string() }
    }
}
