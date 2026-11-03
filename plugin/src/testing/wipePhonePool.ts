import type { App, Plugin } from 'obsidian'
import { Platform } from 'obsidian'
import { durableHostOf, flushHostStorage } from '../sync/hostSyncStorage'
import { IndexedDbStateStore } from '../sync/IndexedDbStateStore'
import {
  requireExternalEnrollmentSafety,
  requireExternalLifecycleSafety,
} from '../sync/external/pluginSafety'
import { completion, wait } from '../sync/idbRequests'
import { tokenOffloadsOf } from '../sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../sync/pathCoordinator'
import {
  executePhonePoolWipe,
  executePoolWipe,
  type PhoneWipeIdentity,
  type PhoneWipeRow,
} from './phonePoolWipe'

const shared = new Map([
  ['abele-sync-host-v1', ['host', 'host-records', 'host-records-v3']],
  ['abele-sync-device-credentials-v1', ['credentials']],
])
async function existing(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(new Error('Database inventory changed'))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
/** Test build only. The manager supplies independently recorded pool identity and confirmation. */
export function wipePhonePool(plugin: Plugin, request: PhoneWipeIdentity) {
  return wipePoolInternal(plugin, request, false)
}
export function wipePool(plugin: Plugin, request: PhoneWipeIdentity) {
  return wipePoolInternal(plugin, request, true)
}
async function wipePoolInternal(plugin: Plugin, request: PhoneWipeIdentity, generic: boolean) {
  const app = plugin.app
  const factory = window.indexedDB
  const host = plugin as Plugin & {
    tokenEngines?: { close(flush: boolean): Promise<void>; ui: { reviews?: { close(): void } } }
  }
  const plugins = (
    app as App & {
      plugins: {
        disablePlugin(id: string): Promise<void>
        enablePlugin(id: string): Promise<void>
        plugins: Record<
          string,
          { tokenHostStartup?: { state: string; error?: string }; tokenEngines?: unknown }
        >
      }
    }
  ).plugins
  return (generic ? executePoolWipe : executePhonePoolWipe)(request, {
    identity: () => ({
      vault: app.vault.getName(),
      appId: (app as App & { appId: string }).appId,
      phone: Platform.isMobile && !Platform.isDesktop,
    }),
    stop: async () => {
      await host.tokenEngines?.close(false)
      host.tokenEngines?.ui.reviews?.close()
      await flushHostStorage(app)
      await plugins.disablePlugin('abele')
      durableHostOf(app)?.close()
    },
    snapshot: async () => {
      if (typeof factory.databases !== 'function') throw new Error('Database enumeration required')
      const databases = (await factory.databases())
        .map((db) => db.name)
        .filter((name): name is string => typeof name === 'string')
      const rows: PhoneWipeRow[] = []
      for (const [name, allowed] of shared) {
        if (!databases.includes(name)) continue
        const db = await existing(factory, name)
        try {
          const stores = Array.from(db.objectStoreNames)
          if (stores.some((store) => !allowed.includes(store)))
            throw new Error('Unknown shared database schema')
          const tx = db.transaction(stores, 'readonly')
          const done = completion(tx, 'cannot inventory pool vault')
          void done.catch(() => {})
          await Promise.all(
            stores.map(
              (store) =>
                new Promise<void>((resolve, reject) => {
                  const cursor = tx.objectStore(store).openCursor()
                  cursor.onerror = () => reject(cursor.error)
                  cursor.onsuccess = () => {
                    const one = cursor.result
                    if (!one) {
                      resolve()
                      return
                    }
                    const value = one.value as { namespace?: string } | null
                    if (!value || typeof value.namespace !== 'string' || !value.namespace) {
                      reject(new Error('Malformed shared namespace row'))
                      return
                    }
                    rows.push({
                      database: name,
                      store,
                      key: one.primaryKey,
                      namespace: value.namespace ?? '',
                      value,
                    })
                    one.continue()
                  }
                })
            )
          )
          await done
        } finally {
          db.close()
        }
      }
      const local: { namespace: string; key: string; value: unknown }[] = []
      for (let index = 0; index < window.localStorage.length; index++) {
        const raw = window.localStorage.key(index)
        if (!raw) continue
        const match = /^(.*)-(abele-(?:sync-|scoped-|local-edit-copies-).*)$/.exec(raw)
        if (!match) continue
        const [, namespace, key] = match
        const text = window.localStorage.getItem(raw)
        let value: unknown
        try {
          value = text === null ? null : JSON.parse(text)
        } catch {
          throw new Error('Malformed scoped plugin local storage')
        }
        local.push({ namespace, key, value })
      }
      return { databases, rows, local }
    },
    erase: async (plan) => {
      // A UUID reference alone is not permission to remove an unrelated database.
      // Inspect every candidate before any destructive namespace/file operation.
      for (const name of plan.databases) {
        const db = await existing(factory, name)
        try {
          const stores = Array.from(db.objectStoreNames)
          if (
            !stores.includes('entries') ||
            !stores.includes('meta') ||
            stores.some((store) => !['entries', 'meta', 'pathCandidates'].includes(store))
          )
            throw new Error('Referenced database is not a recognized plugin ledger')
          const tx = db.transaction('meta', 'readonly')
          const done = completion(tx, 'cannot verify plugin ledger identity')
          const identity = await wait<{ value?: unknown } | undefined>(
            tx.objectStore('meta').get('database-identity-v1')
          )
          await done
          if (typeof identity?.value !== 'string' || !identity.value)
            throw new Error('Referenced plugin ledger identity is unavailable')
        } finally {
          db.close()
        }
      }
      tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault)).clearDrainedState()
      // Commit namespace row removal before deleting private bytes. Never delete shared DBs.
      for (const name of shared.keys()) {
        const selected = plan.rows.filter((row) => row.database === name)
        if (!selected.length) continue
        const db = await existing(factory, name)
        try {
          const tx = db.transaction([...new Set(selected.map((row) => row.store))], 'readwrite')
          const done = completion(tx, 'cannot clear pool vault namespace')
          try {
            await Promise.all(
              selected.map(async (row) => {
                const store = tx.objectStore(row.store)
                const current = await wait(store.get(row.key))
                if (JSON.stringify(current) !== JSON.stringify(row.value))
                  throw new Error('Namespace changed during wipe')
                await wait(store.delete(row.key))
              })
            )
          } catch (error) {
            tx.abort()
            await done.catch(() => {})
            throw error
          }
          await done
        } finally {
          db.close()
        }
      }
      for (const name of plan.databases) {
        console.debug('[e2e sync wipe] deleting owned database', name)
        await IndexedDbStateStore.delete(factory, name)
      }
      for (const key of plan.keys) app.saveLocalStorage(key, null)
      // No legacy config-folder cleanup, public-file walk, or recursive alternate path.
      if (await app.vault.adapter.exists('.abele-sync'))
        await app.vault.adapter.rmdir('.abele-sync', true)
    },
    reload: async () => {
      await plugins.enablePlugin('abele')
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const loaded = plugins.plugins.abele
        if (loaded?.tokenHostStartup?.state === 'failed')
          throw new Error('Phone pool host failed to reload: ' + loaded.tokenHostStartup.error)
        if (loaded?.tokenHostStartup?.state === 'ready' && loaded.tokenEngines) return
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
      }
      throw new Error('Phone pool host did not become ready after reload')
    },
    verify: async () => {
      await requireExternalEnrollmentSafety(app)
      await requireExternalLifecycleSafety(
        app,
        factory,
        undefined,
        true,
        undefined,
        () => {},
        {},
        false,
        true
      )
      const registry = durableHostOf(app)?.loadLocalStorage('abele-sync-connections-v2') as {
        records?: unknown[]
      } | null
      if (registry?.records?.length) throw new Error('Phone pool still has connections')
      for (const key of ['abele-sync-writes', 'abele-sync-recovered-writes']) {
        const rows = durableHostOf(app)?.loadLocalStorage(key)
        if (Array.isArray(rows) && rows.length)
          throw new Error('Phone pool still has recovery records')
      }
    },
  })
}
