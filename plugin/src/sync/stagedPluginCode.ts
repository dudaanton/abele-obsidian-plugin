import type { App } from 'obsidian'
import { settingsCategory, sha256, type VaultClient } from '@abele/sync-core'
import { caseKey, type ChangeItem } from '@abele/sync-protocol'
import type { StagedHost } from './stagedSettings'

/** A rename touches both ends: moving code out of its folder also needs consent. */
export function codePluginIds(change: ChangeItem, ownId: string): string[] {
  const ids = new Set<string>()
  for (const path of [change.path, change.prev_path]) {
    if (path === null) continue
    const parts = path.split('/')
    if (
      settingsCategory(caseKey(path)) !== null &&
      caseKey(parts[1] ?? '') === 'plugins' &&
      parts.length >= 4 &&
      caseKey(parts[2]) !== caseKey(ownId) &&
      !(parts.length === 4 && caseKey(parts[3]) === 'data.json')
    )
      ids.add(parts[2])
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
    const wanted = new Set(ids)
    return (await host.list())
      .filter((one) => accepts(one) && wanted.has(one.version_id))
      .map((one) => one.version_id)
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
  client: VaultClient | null,
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
        (await app.vault.adapter.exists(`${folder}/main.js`)) ||
        (await app.vault.adapter.exists(`${folder}/manifest.json`))
      local = manifestLabel(
        new Uint8Array(await app.vault.adapter.readBinary(`${folder}/manifest.json`))
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
