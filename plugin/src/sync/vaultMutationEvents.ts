import type { Vault } from 'obsidian'

type Listener = (paths: readonly string[]) => void
const EVENTS = Symbol.for('abele.sync.vault-mutation-events-v1')
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
