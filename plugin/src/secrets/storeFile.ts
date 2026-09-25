/**
 * The synced secret store as it sits in `data.json`: its format, and the pure operations on
 * it — make one, open it, write new contents into it, merge two of them.
 *
 * Nothing here touches Obsidian. The keychain and the settings file are `SecretStore`'s
 * business, which is what lets every rule below be tested as plain functions.
 */
import {
  KDF_ITERATIONS,
  MAX_KDF_ITERATIONS,
  MIN_KDF_ITERATIONS,
  deriveKey,
  fromBase64,
  open,
  randomBytes,
  seal,
  toBase64,
  type Sealed,
} from './crypto'

export const STORE_FORMAT = 'abele-secrets'

/**
 * What the settings file holds under `secretStore`. Readable by anyone who has the file, and
 * useless to them: every secret is inside `entries`, which only the key opens.
 */
export interface SecretStoreFile {
  format: typeof STORE_FORMAT
  v: 1
  /** Random, lowercase hex. Names the key's slot in each device's keychain. */
  id: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  /**
   * A known text sealed with the key. It opening is what says the key is right, so a wrong
   * passphrase is told apart from damaged contents — and never decrypts into garbage.
   */
  check: Sealed
  entries: Sealed
}

/** One secret. An empty `value` is a removal, kept so it wins over an older copy elsewhere. */
export interface SecretEntry {
  value: string
  /** When it was last set, in milliseconds. The later one wins a merge. */
  at: number
}

export type SecretEntries = Record<string, SecretEntry>

export type StoreProblem = 'wrong-key' | 'damaged'

export class StoreError extends Error {
  constructor(readonly problem: StoreProblem) {
    super(problem === 'wrong-key' ? 'The key does not open this store' : 'The store is damaged')
  }
}

const CHECK_TEXT = 'abele-secrets-check'
const context = (id: string, part: 'check' | 'entries') => `${STORE_FORMAT}:v1:${id}:${part}`

const isSealed = (value: unknown): value is Sealed =>
  !!value && typeof (value as Sealed).iv === 'string' && typeof (value as Sealed).data === 'string'

/** Whether something read out of a settings file is a store this version can open. */
export function isStoreFile(value: unknown): value is SecretStoreFile {
  if (!value || typeof value !== 'object') return false
  const file = value as SecretStoreFile
  const kdf = file.kdf
  return (
    file.format === STORE_FORMAT &&
    file.v === 1 &&
    typeof file.id === 'string' &&
    /^[a-z0-9]{8,32}$/.test(file.id) &&
    !!kdf &&
    kdf.name === 'PBKDF2' &&
    kdf.hash === 'SHA-256' &&
    Number.isInteger(kdf.iterations) &&
    kdf.iterations >= MIN_KDF_ITERATIONS &&
    kdf.iterations <= MAX_KDF_ITERATIONS &&
    typeof kdf.salt === 'string' &&
    isSealed(file.check) &&
    isSealed(file.entries)
  )
}

/** The keychain id this device keeps the store's key under. */
export const deviceKeyId = (storeId: string): string => `abele-store-key-${storeId}`

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A new store holding `entries`, and the key that opens it.
 *
 * `id` is given when the passphrase changes: the store stays the same store, so another
 * device finds its old key in the same slot, fails the check and says the passphrase moved on,
 * rather than looking as if it had never been set up.
 */
export async function createStore(
  passphrase: string,
  entries: SecretEntries,
  options: { id?: string; iterations?: number } = {}
): Promise<{ file: SecretStoreFile; key: Uint8Array }> {
  const id = options.id ?? hex(randomBytes(6))
  const iterations = options.iterations ?? KDF_ITERATIONS
  const salt = randomBytes(16)
  const key = await deriveKey(passphrase, salt, iterations)

  const file: SecretStoreFile = {
    format: STORE_FORMAT,
    v: 1,
    id,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    check: await seal(key, CHECK_TEXT, context(id, 'check')),
    entries: await seal(key, JSON.stringify(entries), context(id, 'entries')),
  }
  return { file, key }
}

/** The key a passphrase gives for this store — right or wrong; `checkKey` says which. */
export const keyFor = (file: SecretStoreFile, passphrase: string): Promise<Uint8Array> =>
  deriveKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations)

export async function checkKey(file: SecretStoreFile, key: Uint8Array): Promise<boolean> {
  try {
    return (await open(key, file.check, context(file.id, 'check'))) === CHECK_TEXT
  } catch {
    return false
  }
}

const isEntry = (value: unknown): value is SecretEntry =>
  !!value &&
  typeof (value as SecretEntry).value === 'string' &&
  typeof (value as SecretEntry).at === 'number'

/** The secrets inside. Throws `StoreError` saying whether the key or the contents are wrong. */
export async function readEntries(file: SecretStoreFile, key: Uint8Array): Promise<SecretEntries> {
  if (!(await checkKey(file, key))) throw new StoreError('wrong-key')

  let parsed: unknown
  try {
    parsed = JSON.parse(await open(key, file.entries, context(file.id, 'entries')))
  } catch {
    throw new StoreError('damaged')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StoreError('damaged')
  }

  const entries: SecretEntries = {}
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEntry(entry)) entries[id] = { value: entry.value, at: entry.at }
  }
  return entries
}

/** The same store with new contents, under a fresh nonce. */
export async function writeEntries(
  file: SecretStoreFile,
  key: Uint8Array,
  entries: SecretEntries
): Promise<SecretStoreFile> {
  return {
    ...file,
    entries: await seal(key, JSON.stringify(entries), context(file.id, 'entries')),
  }
}

/**
 * One set of secrets out of several copies of it, secret by secret: the latest write of each
 * wins, a removal included. Nothing present in any copy is dropped unless a later copy
 * removed it.
 *
 * A tie — two devices writing the same millisecond — goes to the one holding a value, then to
 * the larger value, so every device settles on the same answer whatever order it merged in.
 */
export function mergeEntries(...copies: SecretEntries[]): SecretEntries {
  const merged: SecretEntries = {}
  for (const copy of copies) {
    for (const [id, entry] of Object.entries(copy)) {
      const held = merged[id]
      if (!held || wins(entry, held)) merged[id] = { value: entry.value, at: entry.at }
    }
  }
  return merged
}

function wins(entry: SecretEntry, held: SecretEntry): boolean {
  if (entry.at !== held.at) return entry.at > held.at
  if (!!entry.value !== !!held.value) return !!entry.value
  return entry.value > held.value
}

export function sameEntries(a: SecretEntries, b: SecretEntries): boolean {
  const ids = Object.keys(a)
  if (ids.length !== Object.keys(b).length) return false
  return ids.every((id) => b[id] && b[id].value === a[id].value && b[id].at === a[id].at)
}
