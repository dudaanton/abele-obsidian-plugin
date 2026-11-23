import type { Vault } from 'obsidian'
import { connectionHost } from './connectionPaths'

type Listener = (paths: readonly string[]) => void
const EVENTS = Symbol.for('abele.sync.vault-mutation-events-v3')
const NOTIFICATION = Symbol.for('abele.sync.vault-index-notification-origin-v1')
export const RECONCILE_ORIGIN = Symbol.for('abele.sync.reconcile-origin-port-v1')
type Notify = (kind: string, path: string, deliver: () => unknown) => unknown
type Notification = { kind: string; path: string; remaining: number }

/** A separate receiver carries origin through the host's awaited reconciliation.
 * The original adapter and its foreign callbacks are never patched. */
export async function reconcileAdapterWithOrigin(
  adapter: object,
  path: string,
  notify: Notify
): Promise<void> {
  const reconcile = Reflect.get(adapter, 'reconcileInternalFile')
  if (typeof reconcile !== 'function') return Promise.resolve()
  const handler = Reflect.get(adapter, 'handler')
  if (typeof handler !== 'function') return reconcile.call(adapter, path)
  let active = true
  const receiver = new Proxy(adapter, {
    get(target, key, view) {
      if (key !== 'handler') return Reflect.get(target, key, view)
      return (kind: string, changed: string, ...args: unknown[]) => {
        const deliver = () => handler.call(target, kind, changed, ...args)
        return active ? notify(kind, changed, deliver) : deliver()
      }
    },
  })
  try {
    await reconcile.call(receiver, path)
  } finally {
    // A callback retained by the host cannot attribute any later notification.
    active = false
  }
}

/** Only the synchronous delivery of our own index callback carries a token. */
export async function reconcileVaultFile(
  vault: Vault,
  adapter: object,
  path: string
): Promise<void> {
  vault = connectionHost(vault) as Vault
  if (!Object.prototype.hasOwnProperty.call(vault, NOTIFICATION))
    Object.defineProperty(vault, NOTIFICATION, { value: undefined, writable: true })
  const notify: Notify = (kind, changed, deliver) => {
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
  const port = Reflect.get(adapter, RECONCILE_ORIGIN)
  await (typeof port === 'function'
    ? port(path, notify)
    : reconcileAdapterWithOrigin(adapter, path, notify))
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
