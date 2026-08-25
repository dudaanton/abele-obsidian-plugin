import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

/**
 * `manifest.json` and `versions.json` live in the repository root, which is where the Obsidian
 * community directory reads them from. This script runs from `plugin/` as an npm `version`
 * hook, so it resolves both files one level up rather than from the working directory.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'manifest.json')
const versionsPath = join(root, 'versions.json')

const targetVersion = process.env.npm_package_version

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const { minAppVersion } = manifest
manifest.version = targetVersion
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n')

// update versions.json with target version and minAppVersion from manifest.json
const versions = JSON.parse(readFileSync(versionsPath, 'utf8'))
versions[targetVersion] = minAppVersion
writeFileSync(versionsPath, JSON.stringify(versions, null, '\t') + '\n')
