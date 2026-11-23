import type { Vault } from 'obsidian'
import { connectionHost } from './connectionPaths'

type Listener = (paths: readonly string[]) => void
const EVENTS = Symbol.for('abele.sync.vault-mutation-events-v2')
const RECONCILING = Symbol.for('abele.sync.vault-index-notifications-v1')
/** Explicit host index refreshes report our already-observed filesystem effects. */
export async function reconcileVaultFile(
  vault: Vault,
  adapter: object,
  path: string
): Promise<void> {
  vault = connectionHost(vault) as Vault
  const reconcile = Reflect.get(adapter, 'reconcileInternalFile')
  if (typeof reconcile !== 'function') return
  let pending = Reflect.get(vault, RECONCILING) as Map<string, number> | undefined
  if (!pending) {
    pending = new Map()
    Object.defineProperty(vault, RECONCILING, { value: pending })
  }
  pending.set(path, (pending.get(path) ?? 0) + 1)
  try {
    await reconcile.call(adapter, path)
  } finally {
    const count = pending.get(path) - 1
    if (count) pending.set(path, count)
    else pending.delete(path)
  }
}
const listeners = (vault: Vault) => Reflect.get(vault, EVENTS) as Set<Listener> | undefined

/** Install lifetime change observation at host startup, before any exchange starts. */
function eventListeners(vault: Vault): Set<Listener> {
  const existing = listeners(vault)
  if (existing) return existing
  const current = new Set<Listener>()
  Object.defineProperty(vault, EVENTS, { value: current })
  if (typeof vault.on !== 'function') return current
  const changed = (file: { path: string }, previous?: string) => {
    const paths = previous === undefined ? [file.path] : [file.path, previous]
    // This is an index notification, not another byte write. Adapter mutations
    // remain observed even during reconciliation, including same-stat saves.
    const pending = Reflect.get(vault, RECONCILING) as Map<string, number> | undefined
    if (paths.every((path) => pending?.has(path))) return
    for (const listener of current) listener(paths)
  }
  vault.on('create', changed)
  vault.on('modify', changed)
  vault.on('delete', changed)
  vault.on('rename', changed)
  return current
}

export function primeVaultMutationEvents(vault: Vault): void {
  eventListeners(vault)
}

export function observeVaultMutationEvents(vault: Vault, listener: Listener): () => void {
  const current = eventListeners(vault)
  current.add(listener)
  return () => {
    current.delete(listener)
  }
}
