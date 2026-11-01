import type { Vault, TAbstractFile, TFolder } from 'obsidian'
import { caseKey } from '@abele/sync-sdk/protocol'

type Child = { path: string; kind: 'file' | 'directory'; node: TAbstractFile }
type FolderMap = {
  node: TFolder
  children: TAbstractFile[]
  length: number
  keys: Map<string, Map<string, Child>>
}
type HostMaps = {
  folders: Map<string, FolderMap>
  signals: Map<AbortSignal, () => void>
  stop(): void
}
const hosts = new WeakMap<Vault, HostMaps>()
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const nameKey = (path: string) => caseKey(path.slice(path.lastIndexOf('/') + 1))
function add(map: FolderMap, node: TAbstractFile): void {
  const path = node.path,
    key = nameKey(path)
  let bucket = map.keys.get(key)
  if (!bucket) map.keys.set(key, (bucket = new Map()))
  bucket.set(path, { path, kind: 'children' in node ? 'directory' : 'file', node })
}

/** Shared host membership, independent of whether a core watcher is running. */
function folderMap(vault: Vault, directory: string, signal?: AbortSignal): FolderMap | undefined {
  if (signal?.aborted) return undefined
  let host = hosts.get(vault)
  if (!host) {
    const maps = new Map<string, FolderMap>()
    const update = (file: TAbstractFile, oldPath?: string, deleted = false) => {
      const before = oldPath ?? file.path
      const old = maps.get(parentOf(before))
      if (old) {
        const key = nameKey(before),
          bucket = old.keys.get(key)
        bucket?.delete(before)
        if (bucket?.size === 0) old.keys.delete(key)
        old.length = old.node.children.length
        old.children = old.node.children
      }
      if (!deleted) {
        const next = maps.get(parentOf(file.path))
        if (next) {
          add(next, file)
          next.length = next.node.children.length
          next.children = next.node.children
        }
      }
      if ('children' in file && (deleted || oldPath !== undefined))
        for (const path of maps.keys())
          if (path === before || path.startsWith(before + '/')) maps.delete(path)
    }
    const refs = [
      vault.on('create', (file) => update(file)),
      vault.on('delete', (file) => update(file, undefined, true)),
      vault.on('rename', (file, before) => update(file, before)),
    ]
    const state: HostMaps = {
      folders: maps,
      signals: new Map(),
      stop: () => {
        if (hosts.get(vault) !== state) return
        hosts.delete(vault)
        for (const ref of refs) vault.offref(ref)
        for (const [signal, stop] of state.signals) signal.removeEventListener('abort', stop)
        state.signals.clear()
        maps.clear()
      },
    }
    hosts.set(vault, (host = state))
  }
  if (signal && !host.signals.has(signal)) {
    host.signals.set(signal, host.stop)
    signal.addEventListener('abort', host.stop, { once: true })
  }
  const folders = host.folders
  const node = (
    directory ? vault.getAbstractFileByPath(directory) : vault.getRoot()
  ) as TFolder | null
  if (!node || !Array.isArray(node.children)) return undefined
  let map = folders.get(directory)
  if (
    !map ||
    map.node !== node ||
    map.children !== node.children ||
    map.length !== node.children.length
  ) {
    map = { node, children: node.children, length: node.children.length, keys: new Map() }
    for (const child of node.children) add(map, child)
    folders.set(directory, map)
  }
  return map
}

/** A lookup visits only matching aliases, amortized O(1) after one folder build. */
export function indexedPathBucket(
  vault: Vault,
  directory: string,
  name: string,
  signal?: AbortSignal
): Child[] | undefined {
  const map = folderMap(vault, directory, signal)
  return map ? [...(map.keys.get(caseKey(name))?.values() ?? [])] : undefined
}

/** A new settled-index pass must not reuse membership from an earlier reindex. */
export function invalidateIndexedPathCandidates(vault: Vault): void {
  hosts.get(vault)?.folders.clear()
}
