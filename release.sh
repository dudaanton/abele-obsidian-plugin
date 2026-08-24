#!/bin/bash
set -e

version="$1"

if [ -z "$version" ]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 1.0.0"
  exit 1
fi

cd plugin

# Bump package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${version}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Bump manifest.json + versions.json
npm_package_version="$version" node version-bump.mjs

cd ..

git add plugin/package.json manifest.json versions.json
git commit -m "chore: bump version to ${version}"
git tag "$version"
