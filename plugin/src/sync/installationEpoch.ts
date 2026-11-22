import type { DataAdapter, Vault } from 'obsidian'
import { observeAdapterConfig } from './adapterConfigChanges'
import { vaultPathKey } from './vaultPathLinks'

type Epochs = {
  name(path: string): string
  read(this: void, path: string): number
  changed(paths: readonly string[]): void
}
const ADAPTER = Symbol.for('abele.sync.installation-epochs-v1')
const VAULT = Symbol.for('abele.sync.installation-events-v1')

function epochs(adapter: DataAdapter, name?: (path: string) => string): Epochs {
  const cached = Reflect.get(adapter, ADAPTER) as Epochs | undefined
  if (cached) {
    if (name && cached.name !== name) {
      cached.name = name
      cached.changed([''])
    }
    return cached
  }
  const paths = new Map<string, number>()
  let generation = 0,
    floor = 0
  const state: Epochs = {
    name: name ?? ((path) => path),
    read(path) {
      path = state.name(path)
      let result = floor
      for (let key = path; key; key = key.slice(0, Math.max(0, key.lastIndexOf('/'))))
        result = Math.max(result, paths.get(key) ?? 0)
      return result
    },
    changed(changed) {
      for (const raw of changed) {
        const path = state.name(raw)
        if (!path) {
          paths.clear()
          floor = ++generation
          continue
        }
        if (!paths.has(path) && paths.size >= 4096) {
          paths.clear()
          floor = ++generation
        }
        paths.set(path, ++generation)
      }
    },
  }
  // One counter per adapter lifetime, with no filesystem/runtime retained.
  Object.defineProperty(adapter, ADAPTER, { value: state })
  observeAdapterConfig(adapter, '', (changed) => state.changed(changed))
  return state
}

export function adapterInstallationEpoch(adapter: DataAdapter): (path: string) => number {
  return epochs(adapter).read
}

export function vaultInstallationEpoch(vault: Vault): (path: string) => number {
  const cached = Reflect.get(vault, VAULT) as ((path: string) => number) | undefined
  if (cached) return cached
  const state = epochs(vault.adapter, vaultPathKey(vault))
  const changed = (file: { path: string }) => state.changed([file.path])
  // Keep history across filesystem replacements and watcher gaps, once per vault.
  // These callbacks retain only bounded counters, never a connection or runtime.
  vault.on('create', changed)
  vault.on('modify', changed)
  vault.on('delete', changed)
  vault.on('rename', (file, previous) => state.changed([file.path, previous]))
  Object.defineProperty(vault, VAULT, { value: state.read })
  return state.read
}
