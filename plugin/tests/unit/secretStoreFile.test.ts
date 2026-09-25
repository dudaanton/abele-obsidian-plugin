/**
 * The synced secret store's file: that it opens with the passphrase and nothing else, that a
 * wrong passphrase is told apart from a tampered file, and that merging two copies loses
 * nothing but what a later write replaced.
 */
import { describe, it, expect } from 'vitest'
import { fromBase64, toBase64 } from '@/secrets/crypto'
import {
  checkKey,
  createStore,
  isStoreFile,
  keyFor,
  mergeEntries,
  readEntries,
  sameEntries,
  StoreError,
  writeEntries,
  type SecretStoreFile,
} from '@/secrets/storeFile'

// The floor the format accepts: the real count is 600 000, which is the point in production
// and half a second per derivation here.
const FAST = { iterations: 1000 }

const flipOneBit = (text: string): string => {
  const bytes = fromBase64(text)
  bytes[bytes.length - 1] ^= 1
  return toBase64(bytes)
}

async function problemOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'none'
  } catch (e) {
    return e instanceof StoreError ? e.problem : 'other'
  }
}

describe('the store file', () => {
  it('gives back exactly what went in, with the passphrase', async () => {
    const entries = { 'abele-github-token': { value: 'github_pat_1', at: 5 } }
    const { file, key } = await createStore('correct horse', entries, FAST)

    expect(await readEntries(file, key)).toEqual(entries)
    // A second device knows only the passphrase and the file.
    const again = await keyFor(JSON.parse(JSON.stringify(file)), 'correct horse')
    expect(await readEntries(file, again)).toEqual(entries)
  })

  it('holds nothing readable: no value, no id of a secret, no passphrase', async () => {
    const { file } = await createStore(
      'correct horse',
      { 'abele-brave-search': { value: 'BSA-very-secret', at: 1 } },
      FAST
    )
    const text = JSON.stringify(file)
    expect(text).not.toContain('BSA-very-secret')
    expect(text).not.toContain('abele-brave-search')
    expect(text).not.toContain('correct horse')
    expect(isStoreFile(JSON.parse(text))).toBe(true)
  })

  it('says a wrong passphrase is wrong, rather than decrypting it into garbage', async () => {
    const { file } = await createStore('correct horse', { a: { value: 'x', at: 1 } }, FAST)
    const wrong = await keyFor(file, 'correct hors')

    expect(await checkKey(file, wrong)).toBe(false)
    expect(await problemOf(readEntries(file, wrong))).toBe('wrong-key')
  })

  it('refuses contents changed by a single bit, and says the file is damaged', async () => {
    const { file, key } = await createStore('pass', { a: { value: 'x', at: 1 } }, FAST)
    const tampered: SecretStoreFile = {
      ...file,
      entries: { ...file.entries, data: flipOneBit(file.entries.data) },
    }
    expect(await problemOf(readEntries(tampered, key))).toBe('damaged')

    const movedNonce: SecretStoreFile = {
      ...file,
      entries: { ...file.entries, iv: flipOneBit(file.entries.iv) },
    }
    expect(await problemOf(readEntries(movedNonce, key))).toBe('damaged')
  })

  it('does not let the check value stand in for the secrets, or one store for another', async () => {
    const { file, key } = await createStore('pass', { a: { value: 'x', at: 1 } }, FAST)
    expect(await problemOf(readEntries({ ...file, entries: file.check }, key))).toBe('damaged')
    // The same ciphertext under another store's id does not open: the id is authenticated.
    expect(await problemOf(readEntries({ ...file, id: 'ffffffffffff' }, key))).toBe('wrong-key')
  })

  it('encrypts every write under a fresh nonce', async () => {
    const entries = { a: { value: 'x', at: 1 } }
    const { file, key } = await createStore('pass', entries, FAST)
    const next = await writeEntries(file, key, entries)
    expect(next.entries.iv).not.toBe(file.entries.iv)
    expect(next.entries.data).not.toBe(file.entries.data)
    expect(await readEntries(next, key)).toEqual(entries)
  })

  it('treats the same passphrase typed on two keyboards as the same passphrase', async () => {
    const { file } = await createStore('café', {}, FAST)
    // "é" as one code point on one device, as "e" and a combining accent on another.
    const decomposed = await keyFor(file, 'café')
    expect(await checkKey(file, decomposed)).toBe(true)
  })

  it('recognises only its own format', () => {
    expect(isStoreFile(null)).toBe(false)
    expect(isStoreFile({ format: 'abele-secrets', v: 2 })).toBe(false)
    expect(isStoreFile('text')).toBe(false)
  })

  it('refuses a file asking for an absurd amount of work before anything is derived', async () => {
    const { file } = await createStore('pass', {}, FAST)
    expect(isStoreFile({ ...file, kdf: { ...file.kdf, iterations: 1e12 } })).toBe(false)
    expect(isStoreFile({ ...file, kdf: { ...file.kdf, iterations: 1 } })).toBe(false)
  })
})

describe('merging two copies', () => {
  it('keeps every secret either side has, the later write winning each', () => {
    const phone = { a: { value: 'from-phone', at: 10 }, b: { value: 'only-phone', at: 3 } }
    const mac = { a: { value: 'from-mac', at: 20 }, c: { value: 'only-mac', at: 4 } }

    expect(mergeEntries(phone, mac)).toEqual({
      a: { value: 'from-mac', at: 20 },
      b: { value: 'only-phone', at: 3 },
      c: { value: 'only-mac', at: 4 },
    })
  })

  it('lets a later removal win, and a later value win over a removal', () => {
    const removed = { a: { value: '', at: 30 } }
    const older = { a: { value: 'old', at: 10 } }
    const newer = { a: { value: 'new', at: 40 } }

    expect(mergeEntries(older, removed)).toEqual(removed)
    expect(mergeEntries(removed, older)).toEqual(removed)
    expect(mergeEntries(removed, newer)).toEqual(newer)
  })

  it('settles a tie the same way on every device, whatever the order', () => {
    const one = { a: { value: 'aaa', at: 7 } }
    const two = { a: { value: 'zzz', at: 7 } }
    const gone = { a: { value: '', at: 7 } }

    expect(mergeEntries(one, two)).toEqual(mergeEntries(two, one))
    expect(mergeEntries(gone, one)).toEqual(one)
    expect(mergeEntries(one, gone)).toEqual(one)
  })

  it('knows when nothing changed', () => {
    const a = { x: { value: '1', at: 1 } }
    expect(sameEntries(a, { x: { value: '1', at: 1 } })).toBe(true)
    expect(sameEntries(a, { x: { value: '1', at: 2 } })).toBe(false)
    expect(sameEntries(a, {})).toBe(false)
  })
})
