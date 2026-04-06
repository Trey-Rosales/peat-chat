use std::path::PathBuf;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let web_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("web")
        .join("dist");

    let web_path = if web_dir.exists() {
        Some(web_dir)
    } else {
        eprintln!("Web UI not found at {}. Run 'cd web && npm run build' first.", web_dir.display());
        None
    };

    let port = peatlink_mobile::ws_server::run_server(8090, web_path)
        .await
        .expect("failed to start server");

    println!("PeatLink mobile server running on http://localhost:{}", port);
    println!("Press Ctrl+C to stop");

    tokio::signal::ctrl_c().await.ok();
    println!("\nShutting down...");
}
