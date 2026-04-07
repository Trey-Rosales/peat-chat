#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CRATE_DIR="$ROOT_DIR/crates/peatlink-mobile"

usage() {
    echo "Usage: $0 <android|ios|bindings-kotlin|bindings-swift>"
    echo ""
    echo "Commands:"
    echo "  android           Cross-compile for Android (arm64-v8a, x86_64)"
    echo "  ios               Cross-compile for iOS (aarch64-apple-ios)"
    echo "  bindings-kotlin   Generate Kotlin UniFFI bindings"
    echo "  bindings-swift    Generate Swift UniFFI bindings"
    echo ""
    echo "Prerequisites:"
    echo "  Android: cargo-ndk, Android NDK (set ANDROID_NDK_HOME)"
    echo "  iOS:     Xcode, rustup target aarch64-apple-ios"
    exit 1
}

build_android() {
    echo "=== Building peatlink-mobile for Android ==="

    # Check cargo-ndk
    if ! command -v cargo-ndk &>/dev/null; then
        echo "Installing cargo-ndk..."
        cargo install cargo-ndk
    fi

    # Add targets
    rustup target add aarch64-linux-android 2>/dev/null || true
    rustup target add x86_64-linux-android 2>/dev/null || true

    JNILIBS="$ROOT_DIR/mobile/android/app/src/main/jniLibs"
    mkdir -p "$JNILIBS"

    cd "$ROOT_DIR"
    cargo ndk \
        -o "$JNILIBS" \
        -t arm64-v8a \
        -t x86_64 \
        build -p peatlink-mobile --release --features bluetooth

    echo "=== Native libraries built ==="

    # UniFFI Kotlin bindings expect the library named "uniffi_peatlink_mobile"
    # but cargo produces "libpeatlink_mobile.so". Rename to match.
    for abi_dir in "$JNILIBS"/*/; do
        if [ -f "${abi_dir}libpeatlink_mobile.so" ]; then
            mv "${abi_dir}libpeatlink_mobile.so" "${abi_dir}libuniffi_peatlink_mobile.so"
        fi
    done

    find "$JNILIBS" -name "*.so" -exec ls -lh {} \;

    # Bundle web UI into Android assets
    WEB_DIST="$ROOT_DIR/web/dist"
    WEB_ASSETS="$ROOT_DIR/mobile/android/app/src/main/assets/web"
    if [ -d "$WEB_DIST" ]; then
        rm -rf "$WEB_ASSETS"
        cp -r "$WEB_DIST" "$WEB_ASSETS"
        echo "=== Web UI bundled into assets/web ==="
    else
        echo "WARNING: web/dist not found — run 'make web-build' first"
    fi
}

build_ios() {
    echo "=== Building peatlink-mobile for iOS ==="

    rustup target add aarch64-apple-ios 2>/dev/null || true
    rustup target add aarch64-apple-ios-sim 2>/dev/null || true

    cd "$ROOT_DIR"

    # Device build (with BLE)
    cargo build -p peatlink-mobile --release --target aarch64-apple-ios --features bluetooth

    # Simulator build (Apple Silicon, with BLE)
    cargo build -p peatlink-mobile --release --target aarch64-apple-ios-sim --features bluetooth

    echo "=== Static libraries built ==="
    ls -lh target/aarch64-apple-ios/release/libpeatlink_mobile.a 2>/dev/null || true
    ls -lh target/aarch64-apple-ios-sim/release/libpeatlink_mobile.a 2>/dev/null || true

    # Create XCFramework
    BINDINGS_DIR="$ROOT_DIR/mobile/ios/bindings"
    mkdir -p "$BINDINGS_DIR"

    # Generate Swift bindings first
    generate_swift_bindings

    XCFW="$ROOT_DIR/mobile/ios/PeatLinkFFI.xcframework"
    rm -rf "$XCFW"

    xcodebuild -create-xcframework \
        -library target/aarch64-apple-ios/release/libpeatlink_mobile.a \
        -library target/aarch64-apple-ios-sim/release/libpeatlink_mobile.a \
        -output "$XCFW"

    echo "=== XCFramework created at $XCFW ==="
}

generate_kotlin_bindings() {
    echo "=== Generating Kotlin UniFFI bindings ==="
    cd "$ROOT_DIR"
    cargo run -p peatlink-mobile --bin uniffi-bindgen -- \
        generate crates/peatlink-mobile/src/peatlink_mobile.udl \
        --language kotlin \
        --out-dir mobile/android/app/src/main/kotlin/
    echo "=== Kotlin bindings generated ==="
}

generate_swift_bindings() {
    echo "=== Generating Swift UniFFI bindings ==="
    cd "$ROOT_DIR"
    cargo run -p peatlink-mobile --bin uniffi-bindgen -- \
        generate crates/peatlink-mobile/src/peatlink_mobile.udl \
        --language swift \
        --out-dir mobile/ios/bindings/
    echo "=== Swift bindings generated ==="
}

case "${1:-}" in
    android) build_android ;;
    ios) build_ios ;;
    bindings-kotlin) generate_kotlin_bindings ;;
    bindings-swift) generate_swift_bindings ;;
    *) usage ;;
esac
