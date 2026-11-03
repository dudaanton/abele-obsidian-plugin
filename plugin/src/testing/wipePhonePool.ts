import type { App, Plugin } from 'obsidian'
import { Platform } from 'obsidian'
import { durableHostOf, flushHostStorage } from '../sync/hostSyncStorage'
import { pendingTeardown } from '../sync/teardownBarrier'
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
async function inspect(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    let absent = false
    let upgrade: number | undefined
    request.onupgradeneeded = (event) => {
      upgrade = event.oldVersion
      absent = event.oldVersion === 0
      console.debug('[e2e sync wipe] database open upgrade refused', name, event.oldVersion)
      request.transaction?.abort()
    }
    // Wait for the abort to finish: never leave an empty replacement database behind.
    request.onerror = () => {
      if (absent) resolve(null)
      else if (upgrade !== undefined)
        reject(new Error('Database inventory changed: ' + name + ' (upgrade from ' + upgrade + ')'))
      else reject(request.error ?? new Error('Cannot inspect database: ' + name))
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
async function existing(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const db = await inspect(factory, name)
  if (!db) throw new Error('Required shared database is absent: ' + name)
  return db
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
  let databaseInventory = ''
  let snapshotNames: (string | undefined)[] = []
  let eraseNames: (string | undefined)[] = []
  const inventory = async () =>
    (await factory.databases())
      .map(({ name, version }) => [name, version] as const)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
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
      if (!durableHostOf(app)?.isClosed) await flushHostStorage(app)
      await plugins.disablePlugin('abele')
      await pendingTeardown(app)
      durableHostOf(app)?.close()
    },
    snapshot: async () => {
      if (typeof factory.databases !== 'function') throw new Error('Database enumeration required')
      const observed = await inventory()
      snapshotNames = observed.map(([name]) => name)
      console.debug('[e2e sync wipe] database inventory', 'snapshot', snapshotNames)
      databaseInventory = JSON.stringify(observed)
      const databases = observed
        .map(([name]) => name)
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
      const observed = await inventory()
      eraseNames = observed.map(([name]) => name)
      console.debug('[e2e sync wipe] database inventory', 'erase', eraseNames)
      if (JSON.stringify(observed) !== databaseInventory)
        throw new Error('Database inventory changed after stopped snapshot')
      // A UUID reference alone is not permission to remove an unrelated database.
      // Inspect every candidate before any destructive namespace/file operation.
      const present: string[] = []
      const absent: string[] = []
      for (const name of plan.databases) {
        const db = await inspect(factory, name)
        if (!db) {
          // Enumeration is not an existence check. Only explicitly owned ledger
          // names may be absent; shared stores above must remain available.
          console.debug('[e2e sync wipe] owned database already absent', name)
          absent.push(name)
          continue
        }
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
          present.push(name)
        } finally {
          db.close()
        }
      }
      // A recreated database must not inherit permission from an absence probe.
      for (const name of absent) {
        const db = await inspect(factory, name)
        if (db) {
          db.close()
          throw new Error('Database appeared during wipe: ' + name)
        }
      }
      tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault)).clearDrainedState()
      for (const name of present) {
        console.debug('[e2e sync wipe] deleting owned database', name)
        await IndexedDbStateStore.delete(factory, name)
      }
      console.debug('[e2e sync wipe] owned databases removed; removing private directory')
      // No legacy config-folder cleanup, public-file walk, or recursive alternate path.
      if (await app.vault.adapter.exists('.abele-sync'))
        await app.vault.adapter.rmdir('.abele-sync', true)
      console.debug('[e2e sync wipe] private directory removed; clearing namespace rows')
      // Keep ownership evidence until databases and private bytes are gone.
      // Never delete shared databases.
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
      console.debug('[e2e sync wipe] namespace rows removed; clearing local keys')
      for (const key of plan.keys) app.saveLocalStorage(key, null)
    },
    reload: async () => {
      await plugins.enablePlugin('abele')
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const loaded = plugins.plugins.abele
        if (loaded?.tokenHostStartup?.state === 'failed')
          throw new Error('Pool vault host failed to reload: ' + loaded.tokenHostStartup.error)
        if (loaded?.tokenHostStartup?.state === 'ready' && loaded.tokenEngines) return
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
      }
      throw new Error('Pool vault host did not become ready after reload')
    },
    verify: async () => {
      // The old module's WeakMap still points at its closed host after reload.
      await (
        window as unknown as { __abeleTest: { verifyPoolWipe(): Promise<void> } }
      ).__abeleTest.verifyPoolWipe()
    },
  }).catch((cause: unknown) => {
    // Phone action failures retain the message even when browser console output
    // is unavailable. Include names only, never namespace rows or credentials.
    const message = (cause as { message?: unknown } | null)?.message
    throw new Error(
      (typeof message === 'string'
        ? message
        : typeof cause === 'string'
          ? cause
          : 'Unknown pool wipe error') +
        '; database inventories snapshot=' +
        JSON.stringify(snapshotNames) +
        ' erase=' +
        JSON.stringify(eraseNames),
      { cause }
    )
  })
}

/** Must run in the newly loaded plugin generation, never the stopped caller. */
export async function verifyPoolWipe(app: App): Promise<void> {
  const factory = window.indexedDB
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
  if (registry?.records?.length) throw new Error('Pool vault still has connections')
  for (const key of ['abele-sync-writes', 'abele-sync-recovered-writes']) {
    const rows = durableHostOf(app)?.loadLocalStorage(key)
    if (Array.isArray(rows) && rows.length) throw new Error('Pool vault still has recovery records')
  }
}
