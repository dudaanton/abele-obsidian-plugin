#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

source ./.prod.env

# Define plugin source and build directories
PLUGIN_DIR="."
BUILD_DIR="${ABELE_BUILD_ARTIFACT:-$PLUGIN_DIR/build}"
if [ "${1:-}" = "--artifact" ]; then
  [ "$#" -eq 2 ] || { echo "Usage: $0 --artifact directory" >&2; exit 1; }
  BUILD_DIR="$2"
  ABELE_BUILD_ARTIFACT="$2"
elif [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--artifact directory]" >&2; exit 1
fi

echo "--- Building Abele Obsidian Plugin ---"

# Install dependencies if node_modules doesn't exist
if [ -z "${ABELE_BUILD_ARTIFACT:-}" ] && [ ! -d "node_modules" ]; then
  echo "Node modules not found. Installing dependencies..."
  npm install
fi

# Explicit artifact requests fail closed; normal standalone use still builds safely.
if [ -n "${ABELE_BUILD_ARTIFACT:-}" ]; then
  node scripts/build-artifact.mjs "$BUILD_DIR" production
else
  echo "Running build..."
  npm run build
fi

echo "--- Copying Plugin Files to Test Vault ---"

# Preserve the metadata-free copy on macOS; ordinary cp is portable on other platforms.
COPY_FLAGS=()
if [ "$(uname)" = "Darwin" ]; then COPY_FLAGS=(-X); fi

# Copy built files
cp "${COPY_FLAGS[@]}" "$BUILD_DIR/main.js" "$TARGET_VAULT_DIR/main.js"
echo "Copied main.js"

cp "${COPY_FLAGS[@]}" "$BUILD_DIR/main.css" "$TARGET_VAULT_DIR/styles.css"
echo "Copied styles.css"

cp "${COPY_FLAGS[@]}" "$BUILD_DIR/manifest.json" "$TARGET_VAULT_DIR/manifest.json"
echo "Copied manifest.json"

echo "--- Plugin Build and Copy Complete ---"
echo "Plugin files are ready in: $TARGET_VAULT_DIR"
