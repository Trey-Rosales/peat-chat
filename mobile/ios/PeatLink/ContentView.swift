import SwiftUI
import WebKit
import CoreBluetooth

// UniFFI-generated bindings (available after cross-compilation + bindgen)
// import PeatLinkFFI

/// PeatLink native iOS shell.
///
/// Lifecycle:
/// 1. Request BLE permissions via CBCentralManager
/// 2. Start embedded Rust server (peat-mesh + axum WS) via UniFFI
/// 3. Start BLE mesh via peat-btle
/// 4. Load React UI in WKWebView pointing at localhost:{port}
struct ContentView: View {
    @StateObject private var bleAuth = BleAuthorization()
    @State private var serverPort: UInt16 = 0
    @State private var serverStarted = false
    @State private var statusMessage = "Starting PeatLink..."

    // Uncomment once UniFFI bindings are available:
    // @State private var node: MobileNode?

    var body: some View {
        ZStack {
            if serverStarted {
                WebViewWrapper(port: serverPort)
                    .edgesIgnoringSafeArea(.all)
            } else {
                // Loading screen
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: Color(hex: "00a884")))
                        .scaleEffect(1.5)
                    Text(statusMessage)
                        .foregroundColor(Color(hex: "8696a0"))
                        .font(.system(size: 14))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(hex: "0b141a"))
            }
        }
        .onAppear {
            startPeatLink()
        }
    }

    private func startPeatLink() {
        // ===== START EMBEDDED RUST SERVER =====
        // Uncomment once UniFFI bindings are available:
        //
        // Task {
        //     do {
        //         let dataDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        //             .appendingPathComponent("peatlink").path
        //         let node = try MobileNode(dataDir: dataDir, displayName: "iOS User")
        //         let port = try node.start(webDir: nil)
        //         self.node = node
        //         self.serverPort = port
        //
        //         statusMessage = "Starting BLE mesh..."
        //
        //         // Start BLE mesh
        //         do {
        //             try node.startBle(
        //                 meshId: "peatlink-default",
        //                 callsign: "IOS-\(String(node.nodeId().prefix(6)))",
        //                 sharedSecret: nil
        //             )
        //         } catch {
        //             print("BLE mesh failed: \(error)")
        //         }
        //
        //         self.serverStarted = true
        //     } catch {
        //         statusMessage = "Failed: \(error)"
        //     }
        // }

        // TEMPORARY: Use external server until cross-compilation is set up
        serverPort = 8090
        serverStarted = true
    }
}

// MARK: - BLE Authorization Helper

class BleAuthorization: NSObject, ObservableObject, CBCentralManagerDelegate {
    @Published var authorized = false
    private var centralManager: CBCentralManager?

    override init() {
        super.init()
        // Creating CBCentralManager triggers the system BLE permission prompt
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            authorized = true
            print("BLE: powered on and authorized")
        case .unauthorized:
            print("BLE: unauthorized")
        case .poweredOff:
            print("BLE: powered off")
        default:
            print("BLE: state \(central.state.rawValue)")
        }
    }
}

// MARK: - WebView Wrapper

struct WebViewWrapper: UIViewRepresentable {
    let port: UInt16

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.043, green: 0.078, blue: 0.102, alpha: 1)
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        let url = URL(string: "http://localhost:\(port)")!
        webView.load(URLRequest(url: url))

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let scanner = Scanner(string: hex)
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
