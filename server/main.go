package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/grandcat/zeroconf"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func main() {
	port := flag.Int("port", 8090, "server port")
	webDir := flag.String("web", "", "path to web/dist directory (serves static files)")
	atakEnabled := flag.Bool("atak", false, "enable ATAK CoT bridge")
	atakUDP := flag.String("atak-udp", "239.2.3.1:6969", "ATAK multicast address:port")
	atakTCP := flag.Int("atak-tcp", 4242, "ATAK TCP CoT port")
	copURL := flag.String("cop-url", "", "COP server URL for TUI forwarding (e.g., http://localhost:3000)")
	flag.Parse()

	hub := NewHub()
	go hub.Run()

	// Start ATAK CoT bridge if enabled
	if *atakEnabled {
		bridge := NewCotBridge(hub)
		hub.cotBridge = bridge
		addr, portStr, err := net.SplitHostPort(*atakUDP)
		if err != nil {
			log.Fatalf("invalid --atak-udp address %q: %v", *atakUDP, err)
		}
		udpPort, err := strconv.Atoi(portStr)
		if err != nil {
			log.Fatalf("invalid --atak-udp port %q: %v", portStr, err)
		}
		if *copURL != "" {
			bridge.copURL = *copURL
			log.Printf("COP TUI forwarding enabled: %s", *copURL)
		}
		go bridge.Start(addr, udpPort, *atakTCP)
	}

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

	// Register mDNS service so Android devices can auto-discover this server
	mdnsServer, err := zeroconf.Register(
		"PeatLink Server",  // instance name
		"_peatlink._tcp",   // service type
		"local.",           // domain
		*port,              // port
		[]string{"version=0.1.0"}, // TXT records
		nil,                // interfaces (nil = all)
	)
	if err != nil {
		log.Printf("WARNING: mDNS registration failed: %v", err)
	} else {
		log.Printf("mDNS: advertising _peatlink._tcp on port %d", *port)
		defer mdnsServer.Shutdown()
	}

	// Handle graceful shutdown
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		log.Println("shutting down...")
		if mdnsServer != nil {
			mdnsServer.Shutdown()
		}
		os.Exit(0)
	}()

	addr := fmt.Sprintf(":%d", *port)

	// Also start HTTPS on port+1 with auto-generated self-signed cert
	// Required for WebRTC getUserMedia on non-localhost origins
	httpsPort := *port + 1
	go func() {
		tlsCert, err := generateSelfSignedCert()
		if err != nil {
			log.Printf("WARNING: HTTPS disabled — failed to generate cert: %v", err)
			return
		}
		tlsAddr := fmt.Sprintf(":%d", httpsPort)
		srv := &http.Server{
			Addr: tlsAddr,
			TLSConfig: &tls.Config{
				Certificates: []tls.Certificate{tlsCert},
			},
		}
		log.Printf("PeatLink HTTPS listening on %s (self-signed, accept in browser)", tlsAddr)
		if err := srv.ListenAndServeTLS("", ""); err != nil {
			log.Printf("HTTPS server error: %v", err)
		}
	}()

	log.Printf("PeatLink server listening on %s (HTTP) and :%d (HTTPS)", addr, httpsPort)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func generateSelfSignedCert() (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"PeatLink"}},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("0.0.0.0")},
		DNSNames:     []string{"localhost", "peatlink.local"},
	}

	// Add all local IPs to the cert SAN
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok {
			template.IPAddresses = append(template.IPAddresses, ipnet.IP)
		}
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyDER, _ := x509.MarshalECPrivateKey(key)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	return tls.X509KeyPair(certPEM, keyPEM)
}
