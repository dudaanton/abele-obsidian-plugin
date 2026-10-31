import { DEVICE_SECRET_PREFIX } from '@/secrets/deviceSecret'
import { completion, wait } from './idbRequests'
import type { DeviceTokenSecrets } from './tokenConnectionRegistry'

const DATABASE = 'abele-sync-device-credentials-v1'
const STORE = 'credentials'
const PREFIX = DEVICE_SECRET_PREFIX + 'token-'
type Row = { namespace: string; reference: string; value: string }
type Keychain = DeviceTokenSecrets & { remove(reference: string): void }

/** A device-local, transaction-committed copy of connection credentials on desktop. */
export class DurableTokenSecrets implements Keychain {
  private readonly values = new Map<string, string>()
  private pending = new Map<string, string | null>()
  private tail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly db: IDBDatabase,
    private readonly namespace: string,
    private readonly keychain: Keychain
  ) {}

  static async open(factory: IDBFactory, namespace: string, keychain: Keychain) {
    if (!namespace) throw new Error('Device credential vault identity is unavailable')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ['namespace', 'reference'] })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const secrets = new DurableTokenSecrets(db, namespace, keychain)
    try {
      const tx = db.transaction(STORE, 'readonly')
      const done = completion(tx, 'cannot read device credentials')
      const rows = await wait<Row[]>(
        tx.objectStore(STORE).getAll(IDBKeyRange.bound([namespace, ''], [namespace, '\uffff']))
      )
      await done
      for (const row of rows) {
        if (!row.reference.startsWith(PREFIX) || typeof row.value !== 'string' || !row.value)
          throw new Error('Device credential record requires recovery')
        secrets.values.set(row.reference, row.value)
      }
      return secrets
    } catch (error) {
      db.close()
      throw error
    }
  }

  get(reference: string): string | null {
    if (!reference.startsWith(PREFIX)) return null
    return this.values.get(reference) ?? this.keychain.get(reference)
  }

  set(reference: string, value: string): void {
    if (!reference.startsWith(PREFIX) || !value) throw new Error('Invalid device credential')
    this.keychain.set(reference, value)
    this.values.set(reference, value)
    this.pending.set(reference, value)
  }

  remove(reference: string): void {
    if (!reference.startsWith(PREFIX)) return
    this.keychain.remove(reference)
    this.values.delete(reference)
    this.pending.set(reference, null)
  }

  /** Import existing keychain entries before a connection can start. */
  async migrate(references: readonly string[]): Promise<void> {
    for (const reference of references) {
      if (!reference.startsWith(PREFIX) || this.values.has(reference)) continue
      const value = this.keychain.get(reference)
      if (value) {
        this.values.set(reference, value)
        this.pending.set(reference, value)
      }
    }
    await this.flush()
  }

  flush(): Promise<void> {
    const running = this.tail.catch(() => {}).then(async () => {
      if (!this.pending.size) return
      const changes = this.pending
      this.pending = new Map()
      let tx: IDBTransaction | undefined
      let done: Promise<void> | undefined
      try {
        tx = this.db.transaction(STORE, 'readwrite')
        done = completion(tx, 'cannot commit device credentials')
        void done.catch(() => {})
        const store = tx.objectStore(STORE)
        for (const [reference, value] of changes) {
          if (value === null) await wait(store.delete([this.namespace, reference]))
          else await wait(store.put({ namespace: this.namespace, reference, value } satisfies Row))
        }
        await done
      } catch (error) {
        try { tx?.abort() } catch { /* Already settled. */ }
        await done?.catch(() => {})
        for (const [reference, value] of changes)
          if (!this.pending.has(reference)) this.pending.set(reference, value)
        throw error
      }
    })
    this.tail = running
    return running
  }

  close(): void {
    this.db.close()
  }
}
