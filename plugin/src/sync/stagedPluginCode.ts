import { vaultDisk } from './vaultPathLinks'
import { sha256 } from './external/hash'
import type { App } from 'obsidian'
import { settingsCategory, type EngineClient } from '@abele/sync-sdk/core'
import { caseKey, type ChangeItem } from '@abele/sync-sdk/protocol'
import type { StagedHost } from './stagedSettings'

/** Shared by legacy staging views and immutable token candidates; unseen items stay pending. */
export function reviewedSelection<T>(
  items: readonly T[],
  ids: readonly string[],
  identity: (item: T) => string,
  accepts: (item: T) => boolean = () => true
): T[] {
  const wanted = new Set(ids)
  return items.filter((item) => accepts(item) && wanted.has(identity(item)))
}

export interface ExecutablePaths {
  scriptsFolder?: string
  configRoots?: string[]
}
/** Ask the retained protocol classifier; host configuration roots are supplied separately. */
function configurationRoots(path: string, options: ExecutablePaths = {}): string[] {
  const first = path.split('/')[0]
  return [
    ...new Set([
      ...(settingsCategory(caseKey(first) + '/app.json') === 'main' ? [first] : []),
      ...(options.configRoots ?? []),
    ]),
  ]
}
const within = (path: string, root: string) => path === root || path.startsWith(root + '/')
function executablePluginId(path: string, roots: string[]): string | null {
  for (const root of roots) {
    const prefix = root.replace(/\/+$/, '') + '/plugins/'
    if (!caseKey(path).startsWith(caseKey(prefix))) continue
    const parts = path.slice(prefix.length).split('/')
    if (parts.length < 2 || (parts.length === 2 && caseKey(parts[1]) === 'data.json')) continue
    return parts[0]
  }
  return null
}
export function configurationPath(path: string, options: ExecutablePaths = {}): boolean {
  return configurationRoots(path, options).some((root) =>
    within(caseKey(path), caseKey(root.replace(/\/+$/, '')))
  )
}
/** Includes this plugin's code, both move endpoints, and directories containing executable code. */
export function executablePath(
  path: string,
  directory = false,
  options: ExecutablePaths = {}
): boolean {
  const folded = caseKey(path),
    scripts = caseKey((options.scriptsFolder ?? 'Scripts').replace(/\/+$/, ''))
  if (!directory && /\.(?:[cm]?js|ts|tsx|jsx|py|sh|bash|zsh|ps1|lua|rb|php|wasm)$/.test(folded))
    return true
  if (scripts && (within(folded, scripts) || (directory && within(scripts, folded)))) return true
  for (const root of configurationRoots(path, options)) {
    const plugins = caseKey(root.replace(/\/+$/, '') + '/plugins')
    if (directory && (within(folded, plugins) || within(plugins, folded))) return true
    if (executablePluginId(path, [root]) !== null) return true
  }
  return false
}

/** A rename touches both ends: moving code out of its folder also needs consent. */
export function codePluginIds(change: ChangeItem, ownId: string): string[] {
  const ids = new Set<string>()
  for (const path of [change.path, change.prev_path]) {
    if (path === null) continue
    const id = executablePluginId(path, configurationRoots(path))
    if (id !== null && caseKey(id) !== caseKey(ownId)) ids.add(id)
  }
  return [...ids]
}

/**
 * Two views of the same durable staging queue. Filter answers as well as lists: a generic
 * settings action cannot authorise code, even if its caller supplies those version ids.
 * Versions are immutable; replacement versions arriving during an answer stay unshown.
 */
export function stagedLane(host: StagedHost, accepts: (change: ChangeItem) => boolean): StagedHost {
  const allowed = async (ids: readonly string[]): Promise<string[]> => {
    return reviewedSelection(await host.list(), ids, (one) => one.version_id, accepts).map(
      (one) => one.version_id
    )
  }
  return {
    ...host,
    list: async () => (await host.list()).filter(accepts),
    apply: async (ids) => {
      const result = await host.apply(await allowed(ids))
      return result === null ? null : { ...result, unshown: result.unshown.filter(accepts) }
    },
    keep: async (paths, ids) => {
      const result = await host.keep(paths, await allowed(ids))
      return result === null ? null : { ...result, unshown: result.unshown.filter(accepts) }
    },
  }
}

interface ManifestLabel {
  name?: string
  version?: string
}
function manifestLabel(bytes: Uint8Array): ManifestLabel {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (value === null || typeof value !== 'object') return {}
  const { name, version } = value as { name?: unknown; version?: unknown }
  return {
    ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
    ...(typeof version === 'string' && version.trim() ? { version: version.trim() } : {}),
  }
}

/** Labels describe the exact staged manifest, never a newer server head or executable bytes. */
export async function pluginCodeNames(
  app: App | null,
  client: EngineClient | null,
  changes: readonly ChangeItem[],
  ownId: string
): Promise<Record<string, string>> {
  const labels: Record<string, string> = Object.create(null) as Record<string, string>
  if (app === null) return labels
  const ids = new Set(changes.flatMap((one) => codePluginIds(one, ownId)))
  for (const id of ids) {
    const folder = `${app.vault.configDir}/plugins/${id}`
    let local: ManifestLabel = {}
    let installed = false
    try {
      installed =
        (await vaultDisk(app.vault).exists(`${folder}/main.js`)) ||
        (await vaultDisk(app.vault).exists(`${folder}/manifest.json`))
      local = manifestLabel(
        new Uint8Array(await vaultDisk(app.vault).readBinary(`${folder}/manifest.json`))
      )
    } catch {
      /* A missing or invalid local manifest leaves the folder as the name. */
    }
    const manifest = changes.find((one) => caseKey(one.path) === caseKey(`${folder}/manifest.json`))
    let incoming: ManifestLabel = {}
    if (manifest?.sha && manifest.op !== 'delete' && client !== null) {
      try {
        const bytes = await client.getBlob(manifest.sha)
        if ((await sha256(bytes)) !== manifest.sha) throw new Error('manifest checksum mismatch')
        incoming = manifestLabel(bytes)
      } catch {
        /* Unavailable metadata never prevents keeping the code staged. */
      }
    }
    const name = incoming.name ?? local.name ?? id
    // If a manifest arrived but could not be read, do not mislabel its version as the old one.
    const version = manifest ? incoming.version : local.version
    labels[id] =
      `${name}${name === id ? '' : ` (${id})`} — ${installed ? 'Changed' : 'New'}` +
      (version ? ` · Version ${version}` : '')
  }
  return labels
}
