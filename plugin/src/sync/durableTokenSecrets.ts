import { DEVICE_SECRET_PREFIX } from '@/secrets/deviceSecret'
import { fromBase64, toBase64 } from '@/secrets/crypto'
import { Platform } from 'obsidian'
import { completion, wait } from './idbRequests'
import type { DeviceTokenSecrets } from './tokenConnectionRegistry'

const DATABASE = 'abele-sync-device-credentials-v1'
const STORE = 'credentials'
const PREFIX = DEVICE_SECRET_PREFIX + 'token-'
type Row = { namespace: string; reference: string; value: string }
type Keychain = DeviceTokenSecrets & { remove(reference: string): void }

export interface CredentialCipher {
  isEncryptionAvailable(): boolean
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

/** The desktop host uses this OS-backed service for its own secret storage. */
export function desktopCredentialCipher(): CredentialCipher {
  if (!Platform.isDesktop) throw new Error('Desktop credential protection is unavailable')
  const host = window as typeof window & {
    electron?: { remote?: { safeStorage?: {
      isEncryptionAvailable(): boolean
      encryptString(value: string): Uint8Array
      decryptString(value: Uint8Array): string
    } } }
  }
  const storage = host.electron?.remote?.safeStorage
  if (!storage) throw new Error('Desktop credential protection is unavailable')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- desktop-only bridge needs native Buffer for decryptString
  const nativeBuffer = require('node:buffer').Buffer as { from(value: Uint8Array): Uint8Array }
  return {
    isEncryptionAvailable: () => storage.isEncryptionAvailable(),
    encrypt: (value) => storage.encryptString(value),
    decrypt: (value) => storage.decryptString(nativeBuffer.from(value)),
  }
}

/** A device-local, transaction-committed copy of connection credentials on desktop. */
export class DurableTokenSecrets implements Keychain {
  private readonly values = new Map<string, string>()
  private readonly persisted = new Map<string, string>()
  private pending = new Map<string, string | null>()
  private tail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly db: IDBDatabase,
    private readonly namespace: string,
    private readonly keychain: Keychain,
    private readonly cipher: CredentialCipher
  ) {}

  static async open(factory: IDBFactory, namespace: string, keychain: Keychain, cipher: CredentialCipher) {
    if (!namespace) throw new Error('Device credential vault identity is unavailable')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ['namespace', 'reference'] })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const secrets = new DurableTokenSecrets(db, namespace, keychain, cipher)
    try {
      const tx = db.transaction(STORE, 'readonly')
      const done = completion(tx, 'cannot read device credentials')
      const rows = await wait<Row[]>(
        tx.objectStore(STORE).getAll(IDBKeyRange.bound([namespace, ''], [namespace, '\uffff']))
      )
      await done
      for (const row of rows) {
        if (typeof row.reference !== 'string') continue
        secrets.persisted.set(row.reference, row.value)
        if (!row.reference.startsWith(PREFIX) || typeof row.value !== 'string' || !row.value) continue
        try {
          const value = secrets.decode(row.reference, row.value)
          if (value) secrets.values.set(row.reference, value)
        } catch { /* A lost OS key or damaged row falls back to the host secret. */ }
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
    const sealed = this.encode(reference, value)
    this.keychain.set(reference, value)
    this.values.set(reference, value)
    this.pending.set(reference, sealed)
  }

  remove(reference: string): void {
    if (!reference.startsWith(PREFIX)) return
    this.keychain.remove(reference)
    this.values.delete(reference)
    this.pending.set(reference, null)
  }

  /** Import existing keychain entries before a connection can start. */
  async migrate(references: readonly string[]): Promise<void> {
    const live = new Set(references.filter((reference) => reference.startsWith(PREFIX)))
    for (const reference of this.persisted.keys()) {
      if (live.has(reference)) continue
      this.values.delete(reference)
      this.pending.set(reference, null)
    }
    for (const reference of references) {
      if (!live.has(reference)) continue
      const value = this.values.get(reference) ?? this.keychain.get(reference)
      if (!value) {
        if (this.persisted.has(reference)) this.pending.set(reference, null)
        continue
      }
      const saved = this.persisted.get(reference)
      if (saved?.startsWith('enc-v1:') && this.values.has(reference)) continue
      if (saved?.startsWith('plain-v1:') && !this.cipher.isEncryptionAvailable()) continue
      this.values.set(reference, value)
      try {
        // An unreadable OS key must not block a still-usable host credential.
        if (!this.cipher.isEncryptionAvailable() && saved?.startsWith('enc-v1:')) continue
        this.pending.set(reference, this.encode(reference, value))
      } catch {
        // Keep the host credential available, but retire an older unsealed row.
        if (saved && !saved.startsWith('enc-v1:')) this.pending.set(reference, null)
      }
    }
    await this.flush()
  }

  private encode(reference: string, value: string): string {
    if (!this.cipher.isEncryptionAvailable()) return 'plain-v1:' + value
    const bound = JSON.stringify({ v: 1, namespace: this.namespace, reference, value })
    return 'enc-v1:' + toBase64(this.cipher.encrypt(bound))
  }

  private decode(reference: string, stored: string): string | null {
    if (stored.startsWith('plain-v1:')) return stored.slice('plain-v1:'.length) || null
    if (!stored.startsWith('enc-v1:')) return stored // Legacy plaintext, rewritten by migrate.
    if (!this.cipher.isEncryptionAvailable()) return null
    const parsed: unknown = JSON.parse(this.cipher.decrypt(fromBase64(stored.slice('enc-v1:'.length))))
    if (!parsed || typeof parsed !== 'object') return null
    const row = parsed as Record<string, unknown>
    return row.v === 1 && row.namespace === this.namespace && row.reference === reference && typeof row.value === 'string'
      ? row.value || null : null
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
        for (const [reference, value] of changes) {
          if (value === null) this.persisted.delete(reference)
          else this.persisted.set(reference, value)
        }
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
