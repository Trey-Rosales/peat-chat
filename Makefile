.PHONY: server server-build web-install web-dev web-build dev \
       mobile-rust mobile-android mobile-ios mobile-bindings-kotlin mobile-bindings-swift \
       rust-check clean test test-go test-web

GO ?= go

# --- Go backend ---
server-build:
	cd server && $(GO) build -o peatlink-server .

server: server-build
	cd server && ./peatlink-server -port 8090

# --- React frontend ---
web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

# --- Full stack dev ---
dev:
	@echo "Start in two terminals:"
	@echo "  Terminal 1: make server"
	@echo "  Terminal 2: make web-dev"
	@echo "  Then open http://localhost:5173"

# --- Native mobile (peat-ffi) ---
mobile-rust:
	cargo build -p peatlink-mobile --release

mobile-android: web-build
	./scripts/build-mobile.sh android
	./scripts/build-mobile.sh bindings-kotlin

mobile-ios: web-build
	./scripts/build-mobile.sh ios

mobile-bindings-kotlin:
	./scripts/build-mobile.sh bindings-kotlin

mobile-bindings-swift:
	./scripts/build-mobile.sh bindings-swift

# --- Embedded Rust server (desktop test) ---
mobile-server: web-build
	cargo run -p peatlink-mobile --bin peatlink-mobile-server

# --- Tests ---
test: test-go test-web

test-go:
	cd server && $(GO) test -v ./...

test-web:
	cd web && npm run test

# --- Rust check ---
rust-check:
	cargo check

# --- Clean ---
clean:
	rm -f server/peatlink-server
	rm -rf web/dist
	rm -rf mobile/android/app/src/main/jniLibs
	rm -rf mobile/ios/PeatLinkFFI.xcframework
	rm -rf mobile/ios/bindings
