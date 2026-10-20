#!/usr/bin/env bash
# Build NyAnime.app from the SwiftPM executable.
#
# SwiftPM has no notion of an app bundle, so this assembles the standard
# Contents/ layout by hand. Run from the macapp directory:
#
#   ./scripts/bundle-app.sh [debug|release]
#
# The resulting bundle targets macOS 13 Ventura, the newest release a 2017
# MacBook Pro can run, and contains a universal (x86_64 + arm64) binary.
set -euo pipefail

CONFIGURATION="${1:-release}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="NyAnime"
BUNDLE_ID="me.cjhauser.nyanime"
VERSION="1.0.0"
BUILD_NUMBER="1"
MIN_MACOS="13.0"

cd "$ROOT"

# Ask SwiftPM where the built products actually landed rather than guessing.
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"
BINARY="$BIN_DIR/$APP_NAME"
if [[ ! -x "$BINARY" ]]; then
  echo "error: expected executable at $BINARY" >&2
  echo "       build it first: swift build -c $CONFIGURATION" >&2
  exit 1
fi

APP="$ROOT/build/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$BINARY" "$APP/Contents/MacOS/$APP_NAME"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$BUILD_NUMBER</string>
    <key>LSMinimumSystemVersion</key>
    <string>$MIN_MACOS</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.entertainment</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
PLIST

# Ad-hoc signature so the bundle launches locally without a developer account.
# A notarized build would replace this with a Developer ID signature.
codesign --force --deep --sign - "$APP" 2>/dev/null \
  || echo "warning: ad-hoc codesign failed; the app may need a manual allow in Privacy & Security"

echo "Built $APP"
echo "  executable: $(lipo -archs "$APP/Contents/MacOS/$APP_NAME" 2>/dev/null || echo unknown)"
echo "  minimum macOS: $MIN_MACOS"
