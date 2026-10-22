import type { App } from 'obsidian'
import { linkHostStorage } from './hostSyncStorage'
import { CONNECTION_STORAGE, ConnectionRegistry, type ConnectionStatus } from './connectionRegistry'

interface Context {
  app: App
  local: App
  registry: ConnectionRegistry
  id: string
}
const contexts = new WeakMap<App, Context>()

/** Thin Obsidian adapter. All other App properties, symbols and vault identity stay shared. */
export function connectionApp(app: App): App {
  const existing = contexts.get(app)
  if (existing) return existing.app
  const registry = ConnectionRegistry.open(app)
  const id = registry.selectedId || registry.add()
  const adapted = connectionAppFor(app, id)
  const context = contexts.get(adapted)
  if (!context) throw new Error('Connection context requires recovery')
  contexts.set(app, context)
  return adapted
}

/** Explicit, permanently bound context for enrolment/recovery of another registry record. */
export function connectionAppFor(app: App, id: string): App {
  const local = contexts.get(app)?.local ?? app
  const registry = ConnectionRegistry.open(local)
  const storage = registry.storage(id)
  const loadLocalStorage = (key: string) => storage.loadLocalStorage(key)
  const saveLocalStorage = (key: string, value: unknown) => storage.saveLocalStorage(key, value)
  const adapted = new Proxy(local, {
    get(target, key) {
      if (key === CONNECTION_STORAGE) return id
      if (key === 'loadLocalStorage') return loadLocalStorage
      if (key === 'saveLocalStorage') return saveLocalStorage
      return Reflect.get(target, key, target)
    },
  })
  const context = { app: adapted, local, registry, id }
  linkHostStorage(adapted, local)
  contexts.set(adapted, context)
  return adapted
}

/** No legacy inventory, migration or network activity is part of token context preparation. */
export async function prepareConnectionApp(app: App): Promise<App> {
  return connectionApp(app)
}

export function connectionStatus(app: App, status: ConnectionStatus): void {
  const context = contexts.get(app)
  if (context) context.registry.setStatus(context.id, status)
}
