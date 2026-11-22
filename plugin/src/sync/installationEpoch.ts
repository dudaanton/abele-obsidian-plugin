import type { DataAdapter, Vault } from 'obsidian'
import { connectionHost } from './connectionPaths'
import { vaultPathKey, observeAdapterMutations, type AdapterMutation } from './vaultPathLinks'

type Observer = (
  paths: readonly string[],
  directory: boolean,
  mutation?: AdapterMutation
) => void | Promise<void>
export type InstallationEpochPort = {
  (this: void, path: string): number
  observe?: (observer: Observer) => () => void
  key?: (path: string) => string
}
type Epochs = {
  name(path: string): string
  read: InstallationEpochPort
  changed(
    paths: readonly string[],
    directory?: boolean,
    mutation?: AdapterMutation
  ): void | Promise<void>
}
const ADAPTER = Symbol.for('abele.sync.installation-epochs-v4')
// Retire the adapter-bound clock retained by earlier plugin instances.
const VAULT = Symbol.for('abele.sync.installation-events-v6')

function epochs(adapter: DataAdapter, name?: (path: string) => string): Epochs {
  const cached = Reflect.get(adapter, ADAPTER) as Epochs | undefined
  if (cached) {
    if (name && cached.name !== name) {
      cached.name = name
      void cached.changed([''])
    }
    return cached
  }
  const state = createEpochs(name)
  // One counter per adapter lifetime, with no filesystem/runtime retained.
  Object.defineProperty(adapter, ADAPTER, { value: state })
  observeAdapterMutations(adapter, (changed, directory, mutation) =>
    state.changed(changed, directory, mutation)
  )
  return state
}

function createEpochs(name?: (path: string) => string): Epochs {
  const paths = new Map<string, number>()
  const observers = new Set<Observer>()
  const active = new Map<string, number>()
  let activeCount = 0,
    overflow = false
  let generation = 0,
    floor = 0
  const state: Epochs = {
    name: name ?? ((path) => path),
    read(path) {
      path = state.name(path)
      if (overflow || active.has('')) return NaN
      let result = floor
      for (let key = path; key; key = key.slice(0, Math.max(0, key.lastIndexOf('/')))) {
        if (active.has(key)) return NaN
        result = Math.max(result, paths.get(key) ?? 0)
      }
      return result
    },
    changed(changed, directory = false, mutation) {
      const normalized = changed.map((path) => state.name(path))
      if (mutation?.phase === 'before') {
        activeCount += normalized.length
        for (const path of normalized) {
          if (!active.has(path) && active.size >= 4096) overflow = true
          if (!overflow) active.set(path, (active.get(path) ?? 0) + 1)
        }
      } else if (mutation?.phase === 'after') {
        activeCount = Math.max(0, activeCount - normalized.length)
        for (const path of normalized) {
          const count = (active.get(path) ?? 0) - 1
          if (count > 0) active.set(path, count)
          else active.delete(path)
        }
        if (!activeCount) {
          active.clear()
          overflow = false
        }
      }
      let reset = false
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
          reset = true
        }
        paths.set(path, ++generation)
      }
      const pending: Promise<void>[] = []
      for (const observe of observers) {
        const result = observe(reset ? [''] : normalized, directory, mutation)
        if (result) pending.push(result)
      }
      if (pending.length) return Promise.all(pending).then(() => {})
    },
  }
  state.read.key = (path) => state.name(path)
  state.read.observe = (observe) => {
    observers.add(observe)
    return () => {
      observers.delete(observe)
    }
  }
  return state
}

export function adapterInstallationEpoch(adapter: DataAdapter): InstallationEpochPort {
  return epochs(adapter).read
}

export function vaultInstallationEpoch(vault: Vault): InstallationEpochPort {
  // Scope views share byte epochs with their replaceable storage host.
  const host = connectionHost(vault) as Vault
  if (host !== vault) return vaultInstallationEpoch(host)
  const cached = Reflect.get(vault, VAULT) as InstallationEpochPort | undefined
  if (cached) return cached
  const state = createEpochs(vaultPathKey(vault))
  let bound = epochs(vault.adapter)
  const watched = new WeakSet<Epochs>()
  const watch = (adapter: DataAdapter, identity: Epochs) => {
    if (watched.has(identity)) return
    watched.add(identity)
    // Prior adapters still invalidate pending proofs until their writes acknowledge.
    observeAdapterMutations(adapter, (paths, directory, mutation) =>
      state.changed(
        paths,
        directory,
        mutation ? { ...mutation, authoritative: identity === epochs(vault.adapter) } : undefined
      )
    )
  }
  watch(vault.adapter, bound)
  const read: InstallationEpochPort = (path: string) => {
    const current = epochs(vault.adapter)
    // Forwarding proxies share the adapter clock; a distinct host adapter does not.
    // Keep one monotonic vault clock so replacement cannot recycle an old epoch.
    if (current !== bound) {
      bound = current
      void state.changed([''])
      watch(vault.adapter, current)
    }
    return state.read(path)
  }
  read.key = state.read.key
  read.observe = state.read.observe
  const changed = (file: { path: string }) => state.changed([file.path])
  // Keep history across filesystem replacements and watcher gaps, once per vault.
  // These callbacks retain only bounded counters, never a connection or runtime.
  if (typeof Reflect.get(vault, 'on') === 'function') {
    vault.on('create', changed)
    vault.on('modify', changed)
    vault.on('delete', changed)
    vault.on('rename', (file, previous) => state.changed([file.path, previous]))
  }
  Object.defineProperty(vault, VAULT, { value: read })
  return read
}
