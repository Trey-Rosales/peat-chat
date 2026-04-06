use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use peatlink_core::{NodeEvent, PeatLinkNode};
use tokio::io::AsyncBufReadExt;
use tokio::sync::broadcast;

#[derive(Parser)]
#[command(name = "peatlink", version, about = "PeatLink — tactical mesh chat")]
struct Args {
    /// Your display name.
    #[arg(short, long)]
    name: String,

    /// Data directory for keys and chat history.
    #[arg(short, long, default_value_os_t = default_data_dir())]
    data_dir: PathBuf,

    /// Peer node ID (public key) to bootstrap from.
    #[arg(short, long)]
    peer: Option<String>,

    /// Chat room to join.
    #[arg(short, long, default_value = "general")]
    room: String,
}

fn default_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".peatlink")
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn,peatlink_core=info".parse().unwrap()),
        )
        .init();

    let args = Args::parse();

    println!("PeatLink v0.1.0 — tactical mesh chat");
    println!("=====================================");

    let mut node = PeatLinkNode::new(args.data_dir.clone(), args.name.clone()).await?;
    println!("Node ID:  {}", node.node_id());
    println!("Name:     {}", args.name);

    node.run().await?;

    // Parse bootstrap peer if provided
    let peers = if let Some(ref peer_str) = args.peer {
        let pk: iroh::PublicKey = peer_str
            .parse()
            .map_err(|e| anyhow::anyhow!("invalid peer ID '{}': {}", peer_str, e))?;
        vec![pk]
    } else {
        vec![]
    };

    let chat_id = node.join_chat(&args.room, peers).await?;
    println!("Room:     {} ({})", args.room, &hex::encode(chat_id)[..16]);
    println!("-------------------------------------");

    // Show recent history
    let history = node.get_messages(&chat_id).await;
    if !history.is_empty() {
        println!("  ({} messages from history)", history.len());
        for msg in history.iter().rev().take(10).rev() {
            println!(
                "[{}] {}: {}",
                msg.timestamp_display(),
                msg.sender_name,
                msg.content
            );
        }
        println!("-------------------------------------");
    }

    println!("Type a message and press Enter. Commands: /quit /history");
    println!();

    let mut event_rx = node.subscribe();
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line? {
                    Some(line) if line.trim().eq_ignore_ascii_case("/quit") => break,
                    Some(line) if line.trim().eq_ignore_ascii_case("/history") => {
                        let msgs = node.get_messages(&chat_id).await;
                        println!("--- History ({} messages) ---", msgs.len());
                        for msg in &msgs {
                            println!("[{}] {}: {}", msg.timestamp_display(), msg.sender_name, msg.content);
                        }
                        println!("--- End ---");
                    }
                    Some(line) if line.trim().is_empty() => continue,
                    Some(line) => {
                        match node.send_message(&chat_id, line.trim().to_string()).await {
                            Ok(msg) => {
                                println!("[{}] {}: {}", msg.timestamp_display(), args.name, msg.content);
                            }
                            Err(e) => {
                                eprintln!("  ! Send failed: {}", e);
                            }
                        }
                    }
                    None => break,
                }
            }
            event = event_rx.recv() => {
                match event {
                    Ok(NodeEvent::MessageReceived { message, .. }) => {
                        println!("[{}] {} (mesh): {}",
                            message.timestamp_display(),
                            message.sender_name,
                            message.content);
                    }
                    Ok(NodeEvent::PeerConnected { peer_id, .. }) => {
                        let short = if peer_id.len() > 12 { &peer_id[..12] } else { &peer_id };
                        println!("  + peer connected: {}...", short);
                    }
                    Ok(NodeEvent::PeerDisconnected { peer_id, .. }) => {
                        let short = if peer_id.len() > 12 { &peer_id[..12] } else { &peer_id };
                        println!("  - peer disconnected: {}...", short);
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("  ! warning: missed {} events", n);
                    }
                    Err(_) => break,
                }
            }
        }
    }

    println!("Goodbye!");
    Ok(())
}
