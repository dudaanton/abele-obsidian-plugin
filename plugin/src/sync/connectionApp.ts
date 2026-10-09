import type { App } from 'obsidian'
import {
  CONNECTION_STORAGE,
  ConnectionRegistry,
  REGISTRY_KEY,
  type ConnectionStatus,
} from './connectionRegistry'

interface Context {
  app: App
  local: App
  registry: ConnectionRegistry
  id: string
}
const contexts = new WeakMap<App, Context>()

/** Thin Obsidian adapter. All other App properties, symbols and vault identity stay shared. */
export function connectionApp(app: App, extraLegacyKeys: string[] = []): App {
  const existing = contexts.get(app)
  if (existing) return existing.app
  const registry = ConnectionRegistry.open(app, extraLegacyKeys)
  const id = registry.selectedId || registry.add('personal')
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
  contexts.set(adapted, context)
  return adapted
}

/** Discover earlier publication descriptors even if a crash preceded their catalogue write. */
export async function prepareConnectionApp(app: App): Promise<App> {
  if (contexts.has(app)) return connectionApp(app)
  if (app.loadLocalStorage(REGISTRY_KEY) != null) return connectionApp(app)
  const files = (await app.vault.adapter.list('')).files
  const keys = files.flatMap((file) =>
    /^\.abele-owner-publication-[a-f0-9]{64}$/.test(file)
      ? ['abele-owner-publication:' + file.slice('.abele-owner-publication-'.length)]
      : []
  )
  return connectionApp(app, keys)
}

export function connectionStatus(app: App, status: ConnectionStatus): void {
  const context = contexts.get(app)
  if (context) context.registry.setStatus(context.id, status)
}
