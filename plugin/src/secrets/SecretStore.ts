/**
 * Every secret the plugin reads or writes goes through here — provider keys, the GitHub
 * token, voice, web search, the named keys scripts and fetch calls use.
 *
 * With the synced store off this is the device's keychain and nothing more. With it on, the
 * store in `data.json` is where secrets live: it travels with the settings, so a key set on
 * one device reaches every other device that has been unlocked once with the passphrase.
 *
 * Values are also kept in the device's keychain, on purpose:
 * - a consumer reads synchronously, and at startup the store is not open yet;
 * - a store lost to a sync mishap costs nothing — every device still has what it had;
 * - turning the store off leaves every device with its keys, not with nothing.
 * "Remove from this device" is what takes them out of the keychain again.
 */
import { ref, type Ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { fromBase64, toBase64 } from './crypto'
import {
  checkKey,
  createStore,
  deviceKeyId,
  isStoreFile,
  keyFor,
  mergeEntries,
  readEntries,
  sameEntries,
  StoreError,
  writeEntries,
  type SecretEntries,
  type SecretStoreFile,
} from './storeFile'

/** Obsidian's `app.secretStorage`, as much of it as is used. */
export interface Keychain {
  getSecret(id: string): string | null
  setSecret(id: string, value: string): void
  /** Present at runtime though missing from `obsidian.d.ts`. */
  deleteSecret?(id: string): boolean
}

/** Where the store is kept and what it is kept for, supplied by the plugin (or a test). */
export interface StoreHost {
  keychain(): Keychain
  /** The store as the settings hold it now; anything, since the file can be edited by hand. */
  read(): unknown
  /** Puts the store into the settings and saves them; `null` takes it out. */
  write(file: SecretStoreFile | null): Promise<void>
  /** The keychain ids the settings point at: what moves into the store when it is made. */
  ids(): string[]
  /** `secretStore` out of every sync-conflict copy of the settings file lying beside it. */
  conflictCopies(): Promise<unknown[]>
  now(): number
}

/**
 * - `off` — no store; the keychain is all there is.
 * - `locked` — a store exists, this device has not been given its passphrase.
 * - `unlocked` — open here; secrets read and write through it.
 * - `stale` — this device's key no longer opens it: the passphrase was changed elsewhere.
 * - `damaged` — the key is right and the contents do not decrypt: edited or corrupted.
 */
export type StoreStatus = 'off' | 'locked' | 'unlocked' | 'stale' | 'damaged'

export class SecretStore {
  readonly status: Ref<StoreStatus> = ref('off')
  /** Bumped whenever the secrets change, for screens showing a masked value. */
  readonly version = ref(0)

  private key: Uint8Array | null = null
  private storeId: string | null = null
  /**
   * The secrets as this device knows them. Kept while locked or stale too — a key set in the
   * meantime is recorded here and merged in when the store opens again.
   */
  private entries: SecretEntries | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly host: StoreHost) {}

  // ── What every feature uses ────────────────────────────────

  get(id: string | undefined | null): string {
    if (!id) return ''
    if (this.status.value === 'unlocked' && this.entries?.[id]) return this.entries[id].value
    return this.host.keychain().getSecret(id) ?? ''
  }

  /**
   * Stores a secret. Throws what the keychain throws for an id it refuses, before anything is
   * recorded, as callers already expect. An empty value is a removal.
   */
  set(id: string, value: string): void {
    if (value) this.host.keychain().setSecret(id, value)
    else this.forget(id)
    this.record(id, value)
  }

  remove(id: string): void {
    this.forget(id)
    this.record(id, '')
  }

  /** Waits for writes to the settings file already under way. */
  flush(): Promise<void> {
    return this.saving
  }

  // ── The store's life ───────────────────────────────────────

  /**
   * Reads the store out of the settings and opens it with this device's key, merging in what
   * this device knew and any sync-conflict copy. At startup, and whenever `data.json` arrives
   * from another device.
   */
  async load(): Promise<void> {
    const file = this.host.read()
    if (!isStoreFile(file)) {
      // Turned off on another device (or never on): the keychain keeps what it has, and the
      // key to a store that is gone is of no use to anyone.
      if (this.storeId) this.forget(deviceKeyId(this.storeId))
      this.reset('off')
      return
    }

    if (this.storeId !== file.id) {
      this.entries = null
      this.key = null
    }
    this.storeId = file.id

    const saved = this.host.keychain().getSecret(deviceKeyId(file.id))
    if (!saved) {
      this.key = null
      this.status.value = 'locked'
      return
    }

    await this.open(file, fromBase64(saved))
  }

  /** Makes the store out of the secrets this device holds now. */
  async enable(passphrase: string, options: { iterations?: number } = {}): Promise<void> {
    if (this.status.value !== 'off') throw new Error('A synced store already exists')

    const now = this.host.now()
    const entries: SecretEntries = {}
    for (const id of new Set(this.host.ids())) {
      const value = this.host.keychain().getSecret(id)
      if (value) entries[id] = { value, at: now }
    }

    const { file, key } = await createStore(passphrase, entries, options)
    this.host.keychain().setSecret(deviceKeyId(file.id), toBase64(key))
    await this.host.write(file)

    this.storeId = file.id
    this.key = key
    this.entries = entries
    this.status.value = 'unlocked'
    this.version.value++
  }

  /** `false` when the passphrase is not the store's; nothing is kept in that case. */
  async unlock(passphrase: string): Promise<boolean> {
    const file = this.host.read()
    if (!isStoreFile(file)) return false

    const key = await keyFor(file, passphrase)
    if (!(await checkKey(file, key))) return false

    if (this.storeId !== file.id) this.entries = null
    this.storeId = file.id

    // What this device held before it joined, at time zero: added where the store has no
    // such secret, and never over one the store has — nor over one it removed.
    const local: SecretEntries = {}
    for (const id of new Set(this.host.ids())) {
      const value = this.host.keychain().getSecret(id)
      if (value) local[id] = { value, at: 0 }
    }
    this.entries = mergeEntries(local, this.entries ?? {})

    this.host.keychain().setSecret(deviceKeyId(file.id), toBase64(key))
    await this.open(file, key)
    return this.status.value === 'unlocked'
  }

  /** Re-encrypts everything under a new passphrase. Other devices will ask for it. */
  async changePassphrase(passphrase: string, options: { iterations?: number } = {}) {
    if (this.status.value !== 'unlocked' || !this.entries || !this.storeId) {
      throw new Error('The store is not open on this device')
    }
    await this.saving
    const { file, key } = await createStore(passphrase, this.entries, {
      ...options,
      id: this.storeId,
    })
    this.host.keychain().setSecret(deviceKeyId(file.id), toBase64(key))
    this.key = key
    await this.host.write(file)
  }

  /**
   * "Remove from this device": the key and every secret the store holds leave this device's
   * keychain. The store itself, and every other device, are untouched.
   */
  async lock(): Promise<void> {
    await this.saving
    if (this.storeId) this.forget(deviceKeyId(this.storeId))
    for (const id of Object.keys(this.entries ?? {})) this.forget(id)
    this.entries = null
    this.key = null
    this.status.value = this.storeId ? 'locked' : 'off'
    this.version.value++
  }

  /**
   * Turns the store off everywhere: the secrets stay in this device's keychain, the store
   * leaves the settings. Another device keeps what it last had.
   */
  async disable(): Promise<void> {
    if (this.status.value !== 'unlocked') throw new Error('The store is not open on this device')
    await this.saving
    this.mirror(this.entries ?? {})
    if (this.storeId) this.forget(deviceKeyId(this.storeId))
    await this.host.write(null)
    this.reset('off')
  }

  /**
   * Drops a store nobody can open — damaged, or whose passphrase is forgotten — out of the
   * settings, so a new one can be made. This device's keychain keeps what it has.
   */
  async discard(): Promise<void> {
    await this.saving
    if (this.storeId) this.forget(deviceKeyId(this.storeId))
    await this.host.write(null)
    this.reset('off')
  }

  /** How many secrets the store holds, removals not counted. */
  count(): number {
    return Object.values(this.entries ?? {}).filter((entry) => entry.value).length
  }

  // ── Inside ─────────────────────────────────────────────────

  private async open(file: SecretStoreFile, key: Uint8Array): Promise<void> {
    let incoming: SecretEntries
    try {
      incoming = await readEntries(file, key)
    } catch (e) {
      this.key = null
      this.status.value = e instanceof StoreError && e.problem === 'damaged' ? 'damaged' : 'stale'
      return
    }

    const copies: SecretEntries[] = []
    for (const copy of await this.host.conflictCopies().catch((): unknown[] => [])) {
      if (!isStoreFile(copy) || copy.id !== file.id) continue
      try {
        copies.push(await readEntries(copy, key))
      } catch {
        // A copy under an older passphrase, or broken: what it held is either in the store
        // already or cannot be read by anyone — there is nothing to merge.
      }
    }

    const merged = mergeEntries(this.entries ?? {}, incoming, ...copies)
    this.key = key
    this.entries = merged
    this.status.value = 'unlocked'
    this.mirror(merged)
    this.version.value++

    // Something here the file does not have — a key set while the other device's copy was
    // on its way, or one out of a conflict copy: the file gets it, or it would be lost at
    // this device's next restart.
    if (!sameEntries(merged, incoming)) this.persist()
  }

  private record(id: string, value: string): void {
    if (this.status.value === 'off' || !this.storeId) return
    this.entries = { ...(this.entries ?? {}), [id]: { value, at: this.host.now() } }
    this.version.value++
    if (this.status.value === 'unlocked') this.persist()
  }

  private persist(): void {
    this.saving = this.saving.then(async () => {
      const file = this.host.read()
      if (!isStoreFile(file) || file.id !== this.storeId || !this.key || !this.entries) return
      // The passphrase may have changed on another device since this one opened the store.
      // Writing now would seal the secrets under the old key beside a check under the new one,
      // and no device could open them again. The entry stays in memory for the next unlock.
      if (!(await checkKey(file, this.key))) {
        this.key = null
        this.status.value = 'stale'
        return
      }
      try {
        await this.host.write(await writeEntries(file, this.key, this.entries))
      } catch (e) {
        // Never the secrets themselves: the message names the failure, not what was written.
        console.error('[Abele] the synced secrets could not be saved', (e as Error)?.message)
      }
    })
  }

  /** The keychain made to hold exactly what the store says, for the ids the store knows. */
  private mirror(entries: SecretEntries): void {
    const keychain = this.host.keychain()
    for (const [id, entry] of Object.entries(entries)) {
      try {
        if (!entry.value) this.forget(id)
        else if (keychain.getSecret(id) !== entry.value) keychain.setSecret(id, entry.value)
      } catch {
        // An id the keychain refuses, from a hand-edited file: skipped, the rest still land.
      }
    }
  }

  private forget(id: string): void {
    const keychain = this.host.keychain()
    try {
      if (keychain.deleteSecret) keychain.deleteSecret(id)
      else keychain.setSecret(id, '')
    } catch {
      // Nothing under that id, or an id the keychain never accepted.
    }
  }

  private reset(status: StoreStatus): void {
    this.key = null
    this.storeId = null
    this.entries = null
    this.status.value = status
    this.version.value++
  }
}

let current: SecretStore | null = null

/**
 * The one store. Before the plugin has made its own — in tests, mostly — it is a store that is
 * off, reading straight from the app's keychain.
 */
export function secrets(): SecretStore {
  current ??= new SecretStore({
    keychain: () => GlobalStore.getInstance().app.secretStorage,
    read: () => null,
    write: async () => {},
    ids: () => [],
    conflictCopies: async () => [],
    now: () => Date.now(),
  })
  return current
}

/** Installs the store the plugin made, or `null` to go back to the fallback. */
export function setSecrets(next: SecretStore | null): void {
  current = next
}
