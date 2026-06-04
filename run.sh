#!/usr/bin/env sh
set -e

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}-${ARCH}" in
  Darwin-arm64)  BIN=safeshare-macos-arm64 ;;
  Darwin-x86_64) BIN=safeshare-macos-x64   ;;
  Linux-x86_64)  BIN=safeshare-linux-x64   ;;
  Linux-aarch64) BIN=safeshare-linux-arm64  ;;
  *)
    echo "Unsupported platform: ${OS}-${ARCH}"
    echo "Download a binary manually from https://github.com/a7ul/safeshare/releases/latest"
    exit 1
    ;;
esac

BASE=https://github.com/a7ul/safeshare/releases/latest/download

echo "Downloading ${BIN}..."
curl -fsSL "${BASE}/${BIN}" -o safeshare
chmod +x safeshare

echo ""
echo "SafeShare → http://localhost:8000"
echo ""
./safeshare
