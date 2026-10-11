#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

source ./.test.env

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

# Explicit artifact requests fail closed; production and sharing-test are never interchangeable.
if [ -n "${ABELE_BUILD_ARTIFACT:-}" ]; then
  node scripts/build-artifact.mjs "$BUILD_DIR" sharing-test
else
  echo "Running build..."
  npm run build:test
fi

echo "--- Copying Plugin Files to Test Vault ---"

# Create target directory in test vault if it doesn't exist
mkdir -p "$TARGET_VAULT_DIR"
echo "Ensured target directory exists: $TARGET_VAULT_DIR"

# Copy built files
cp "$BUILD_DIR/main.js" "$TARGET_VAULT_DIR/main.js"
echo "Copied main.js"

cp "$BUILD_DIR/main.css" "$TARGET_VAULT_DIR/styles.css"
echo "Copied styles.css"

cp "$BUILD_DIR/manifest.json" "$TARGET_VAULT_DIR/manifest.json"
echo "Copied manifest.json"

echo "--- Plugin Build and Copy Complete ---"
echo "Plugin files are ready in: $TARGET_VAULT_DIR"
