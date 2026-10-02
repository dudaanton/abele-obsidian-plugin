import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { SyncService } from '@/sync/SyncService'
const BACKUP = 'task14-isolated-fixture'
const KEYS = [
  'abele-sync-connection',
  'abele-sync-ledger',
  'abele-sync-ledger-proof',
  'abele-sync-ledger-bootstrap',
  'abele-script-provenance',
]
const FILES = ['.abele-sync-ignore', '.abele-script-managed']
interface Backup {
  root: string
  local: Record<string, unknown>
  files: Record<string, number[] | null>
  workspace: unknown
  dbNames: string[]
  digests: Record<string, string>
}
/** Readonly fingerprint: opening an absent old database is forbidden, never bootstrap it. */
async function databaseDigest(name: string): Promise<string> {
  const names = (await indexedDB.databases()).map((d) => d.name)
  if (!names.includes(name)) return 'absent'
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.onupgradeneeded = () => {
      r.transaction?.abort()
      reject(new Error('Original fixture database changed during inspection'))
    }
  })
  try {
    const stores = Array.from(db.objectStoreNames),
      rows: unknown[] = []
    if (stores.length) {
      const tx = db.transaction(stores, 'readonly')
      await Promise.all(
        stores.map(async (name) => {
          const s = tx.objectStore(name)
          const get = <T>(r: IDBRequest<T>) =>
            new Promise<T>((resolve, reject) => {
              r.onsuccess = () => resolve(r.result)
              r.onerror = () => reject(r.error)
            })
          const keys = s.getAllKeys(),
            values = s.getAll()
          const indexes = Array.from(s.indexNames).map((n) => {
            const i = s.index(n)
            return { name: n, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }
          })
          rows.push({
            name,
            keyPath: s.keyPath,
            autoIncrement: s.autoIncrement,
            indexes,
            keys: await get(keys),
            values: await get(values),
          })
        })
      )
    }
    const encoded = JSON.stringify(
      { version: db.version, rows: rows.sort((a: any, b: any) => a.name.localeCompare(b.name)) },
      (_key, value) => (value instanceof ArrayBuffer ? [...new Uint8Array(value)] : value)
    )
    return await sha256(new TextEncoder().encode(encoded))
  } finally {
    db.close()
  }
}
/** Test-only profile isolation, not resetting the user's retained ledger: old DBs stay untouched. */
export async function prepareFixtureContext(app: App, root: string): Promise<boolean> {
  const svc = SyncService.getInstance()
  if (
    svc.connection.value.vaultId ||
    svc.connection.value.deviceTokenId ||
    svc.connection.value.pendingRevoke.length
  )
    throw new Error('Active fixture connection left untouched')
  if (app.loadLocalStorage(BACKUP)) throw new Error('Fixture backup already exists')
  if ((await app.vault.adapter.exists(root)) || (await app.vault.adapter.exists(root + '-private')))
    throw new Error('Fixture namespace already exists')
  const local = Object.fromEntries(KEYS.map((k) => [k, app.loadLocalStorage(k)])),
    files: Backup['files'] = {}
  for (const path of FILES)
    files[path] = (await app.vault.adapter.exists(path))
      ? [...new Uint8Array(await app.vault.adapter.readBinary(path))]
      : null
  const dbNames = (await indexedDB.databases()).flatMap((d) => (d.name ? [d.name] : [])),
    digests: Record<string, string> = {}
  const ledger = local['abele-sync-ledger'] as { stateId?: string } | null,
    trust = local['abele-script-provenance'] as { id?: string } | null
  for (const name of [
    ledger?.stateId ? 'abele-sync-' + ledger.stateId : null,
    trust?.id ? 'abele-script-provenance-' + trust.id : null,
  ].filter((v): v is string => !!v))
    digests[name] = await databaseDigest(name)
  const backup: Backup = {
    root,
    local,
    files,
    workspace: app.workspace.getLayout(),
    dbNames,
    digests,
  }
  app.saveLocalStorage(BACKUP, backup)
  if (JSON.stringify(app.loadLocalStorage(BACKUP)) !== JSON.stringify(backup))
    throw new Error('Fixture backup was not persisted')
  // Clear only vault-local bindings, never touch old DBs. Adoption now allocates fresh UUIDs.
  for (const key of KEYS) app.saveLocalStorage(key, null)
  if (await app.vault.adapter.exists('.abele-script-managed'))
    await app.vault.adapter.remove('.abele-script-managed')
  await app.vault.adapter.writeBinary(
    '.abele-sync-ignore',
    new TextEncoder().encode('*\n!' + root + '/\n!' + root + '/**\n').buffer
  )
  return true
}
export async function restoreFixtureContext(
  app: App
): Promise<{ restored: boolean; errors: string[] }> {
  const p = app.loadLocalStorage(BACKUP) as Backup | null
  if (!p) throw new Error('No isolated fixture backup')
  const errors: string[] = [],
    attempt = async (label: string, work: () => Promise<unknown>) => {
      try {
        await work()
      } catch {
        errors.push(label)
      }
    }
  const ledger = app.loadLocalStorage('abele-sync-ledger') as { stateId?: string } | null,
    trust = app.loadLocalStorage('abele-script-provenance') as { id?: string } | null
  await attempt('forget', () => SyncService.getInstance().forget())
  for (const [key, value] of Object.entries(p.local))
    await attempt('restore local binding', async () => {
      app.saveLocalStorage(key, value)
      if (JSON.stringify(app.loadLocalStorage(key)) !== JSON.stringify(value))
        throw new Error('Mismatch')
    })
  for (const [path, bytes] of Object.entries(p.files))
    await attempt('restore sentinel/ignore', async () => {
      if (bytes === null) {
        if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path)
      } else await app.vault.adapter.writeBinary(path, new Uint8Array(bytes).buffer)
      const actual = (await app.vault.adapter.exists(path))
        ? [...new Uint8Array(await app.vault.adapter.readBinary(path))]
        : null
      if (JSON.stringify(actual) !== JSON.stringify(bytes)) throw new Error('Mismatch')
    })
  for (const root of [p.root, p.root + '-private'])
    await attempt('remove owned folder', async () => {
      // Raw adapter cleanup is restricted to the two owned synthetic directories, not a user
      // deletion action. Leave the user's trash preference and all original paths untouched.
      if (await app.vault.adapter.exists(root)) await app.vault.adapter.rmdir(root, true)
      if (await app.vault.adapter.exists(root)) throw new Error('Owned folder remains')
    })
  for (const name of [
    ledger?.stateId ? 'abele-sync-' + ledger.stateId : null,
    trust?.id ? 'abele-script-provenance-' + trust.id : null,
  ].filter((v): v is string => !!v && !p.dbNames.includes(v)))
    await attempt(
      'remove new fixture database',
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase(name)
          r.onsuccess = () => resolve()
          r.onerror = () => reject(r.error)
          r.onblocked = () => reject(new Error('Blocked'))
        })
    )
  for (const [name, digest] of Object.entries(p.digests))
    await attempt('verify original database', async () => {
      if ((await databaseDigest(name)) !== digest) throw new Error('Original database changed')
    })
  await attempt('restore workspace', () => app.workspace.changeLayout(p.workspace as any))
  if (!errors.length) app.saveLocalStorage(BACKUP, null)
  return { restored: !errors.length, errors }
}
