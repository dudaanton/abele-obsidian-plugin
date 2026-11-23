import type { Vault } from 'obsidian'
import { connectionHost } from './connectionPaths'
import { reconcileGuardedAdapter } from './vaultPathLinks'

type Listener = (paths: readonly string[]) => void
const EVENTS = Symbol.for('abele.sync.vault-mutation-events-v3')
const NOTIFICATION = Symbol.for('abele.sync.vault-index-notification-origin-v1')
export const RECONCILE_ORIGIN = Symbol.for('abele.sync.reconcile-origin-port-v1')
export type ReconciliationNotify = (kind: string, path: string, deliver: () => unknown) => unknown
type Notification = { kind: string; path: string; remaining: number }

/** Only the synchronous delivery of our own index callback carries a token. */
export async function reconcileVaultFile(
  vault: Vault,
  adapter: object,
  path: string
): Promise<void> {
  vault = connectionHost(vault) as Vault
  if (!Object.prototype.hasOwnProperty.call(vault, NOTIFICATION))
    Object.defineProperty(vault, NOTIFICATION, { value: undefined, writable: true })
  const notify: ReconciliationNotify = (kind, changed, deliver) => {
    const event = kind === 'file-created' ? 'create' : kind === 'modified' ? 'modify' : undefined
    if (changed !== path || !event) return deliver()
    const previous = Reflect.get(vault, NOTIFICATION)
    Reflect.set(vault, NOTIFICATION, { kind: event, path, remaining: 1 } satisfies Notification)
    try {
      return deliver()
    } finally {
      Reflect.set(vault, NOTIFICATION, previous)
    }
  }
  await reconcileGuardedAdapter(adapter, path, notify)
}
const listeners = (vault: Vault) => Reflect.get(vault, EVENTS) as Set<Listener> | undefined

/** Install lifetime change observation at host startup, before any exchange starts. */
function eventListeners(vault: Vault): Set<Listener> {
  const existing = listeners(vault)
  if (existing) return existing
  const current = new Set<Listener>()
  Object.defineProperty(vault, EVENTS, { value: current })
  if (typeof vault.on !== 'function') return current
  const changed = (kind: string, file: { path: string }, previous?: string) => {
    const paths = previous === undefined ? [file.path] : [file.path, previous]
    const origin = Reflect.get(vault, NOTIFICATION) as Notification | undefined
    if (
      origin?.remaining === 1 &&
      origin.kind === kind &&
      paths.length === 1 &&
      origin.path === file.path
    ) {
      origin.remaining = 0
      return
    }
    for (const listener of current) listener(paths)
  }
  vault.on('create', (file) => changed('create', file))
  vault.on('modify', (file) => changed('modify', file))
  vault.on('delete', (file) => changed('delete', file))
  vault.on('rename', (file, previous) => changed('rename', file, previous))
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
