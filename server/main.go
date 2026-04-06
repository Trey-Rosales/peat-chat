package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func main() {
	port := flag.Int("port", 8090, "server port")
	webDir := flag.String("web", "", "path to web/dist directory (serves static files)")
	flag.Parse()

	hub := NewHub()
	go hub.Run()

	// WebSocket endpoint
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("upgrade error: %v", err)
			return
		}
		serveWs(hub, w, r, conn, "")
	})

	// Serve static web files
	staticDir := *webDir
	if staticDir == "" {
		// Try ../web/dist relative to the binary
		exe, _ := os.Executable()
		staticDir = filepath.Join(filepath.Dir(exe), "..", "web", "dist")
		if _, err := os.Stat(staticDir); err != nil {
			staticDir = filepath.Join(".", "..", "web", "dist")
		}
	}

	if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
		log.Printf("serving web UI from: %s", staticDir)
		http.Handle("/", http.FileServer(http.Dir(staticDir)))
	} else {
		log.Printf("no web UI found at %s (run 'make web-build' first)", staticDir)
		http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintf(w, `<html><body style="background:#0b141a;color:#e9edef;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
				<div style="text-align:center"><h1>PeatLink</h1><p>Web UI not built. Run: <code>make web-build</code></p></div>
			</body></html>`)
		})
	}

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("PeatLink server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
