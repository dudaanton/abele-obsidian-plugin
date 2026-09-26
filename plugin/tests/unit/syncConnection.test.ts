/**
 * The device's connection, as this vault's local storage holds it.
 *
 * Local storage is the app's, filed under its own id for the vault, and no file carries it —
 * which is the point: a Finder copy, a synced `data.json` or a transfer used to hand one
 * device's identity to another. What is asserted here is the record itself: it reads back what
 * was written, a record that is not one reads as a device nobody set up, and a keychain name
 * this plugin never mints is not taken at its word.
 */
import { describe, it, expect } from 'vitest'
import {
  CONNECTION_KEY,
  MOBILE_MAX_FILE_BYTES,
  connectionProblem,
  emptyConnection,
  migrateConnection,
  readConnection,
  writeConnection,
  type DeviceConnection,
} from '@/sync/connection'
import type { LocalStorage } from '@/sync/ledgerId'

/** A vault's local storage, stored the way Obsidian stores it: as JSON, never by reference. */
function storage(
  initial: Record<string, unknown> = {}
): LocalStorage & { raw: Map<string, string> } {
  const raw = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]))
  return {
    raw,
    loadLocalStorage: (key) => (raw.has(key) ? (JSON.parse(raw.get(key)!) as unknown) : null),
    saveLocalStorage: (key, data) => void raw.set(key, JSON.stringify(data)),
  }
}

const connected = (): DeviceConnection => ({
  ...emptyConnection(),
  serverUrl: 'https://sync.example.com',
  vaultId: 'v1',
  deviceId: 'd1',
  deviceTokenId: 'abele-sync-device-abc',
  deviceName: 'Laptop',
  paused: true,
  migrated: true,
})

describe('the connection record', () => {
  it('reads back what was written', () => {
    const local = storage()
    const record = connected()
    record.selective.video = false
    record.selective.excludedFolders = ['Archive']
    record.selective.maxFileBytes = 1024

    writeConnection(local, record)

    expect(readConnection(local)).toEqual(record)
    expect(local.raw.has(CONNECTION_KEY)).toBe(true)
  })

  it('is a device nobody set up when there is no record at all', () => {
    expect(readConnection(storage())).toEqual(emptyConnection())
    expect(emptyConnection().migrated).toBe(false)
  })

  it('reads a malformed record as empty, field by field', () => {
    const local = storage({
      [CONNECTION_KEY]: { serverUrl: 42, vaultId: ['v1'], paused: 'yes', selective: 'all' },
    })

    expect(readConnection(local)).toEqual(emptyConnection())
    expect(readConnection(storage({ [CONNECTION_KEY]: 'nonsense' }))).toEqual(emptyConnection())
    expect(readConnection(storage({ [CONNECTION_KEY]: [1, 2] }))).toEqual(emptyConnection())
  })

  /** Pointed at a provider's key, the id would send that key to the server as a bearer token. */
  it('reads a keychain id this plugin never mints as none', () => {
    const local = storage({
      [CONNECTION_KEY]: { ...connected(), deviceTokenId: 'abele-brave-search' },
    })

    expect(readConnection(local).deviceTokenId).toBe('')
    expect(readConnection(local).serverUrl).toBe('https://sync.example.com')
  })

  it('hands back a record of its own, which nothing else can edit', () => {
    const local = storage()
    writeConnection(local, connected())
    const first = readConnection(local)
    first.selective.excludedFolders.push('Scans')

    expect(readConnection(local).selective.excludedFolders).toEqual([])
  })

  it('fills a half-written selective block out from the defaults', () => {
    const local = storage({
      [CONNECTION_KEY]: {
        ...connected(),
        selective: { video: false, excludedFolders: ['Archive', 7], settings: { hotkeys: false } },
      },
    })
    const { selective } = readConnection(local)

    expect(selective.video).toBe(false)
    expect(selective.images).toBe(true)
    expect(selective.excludedFolders).toEqual(['Archive'])
    expect(selective.settings.hotkeys).toBe(false)
    expect(selective.settings.appearance).toBe(true)
  })
})

describe('the size cap', () => {
  it('is 50 MB on a phone and nothing on a desktop when the record names none', () => {
    expect(readConnection(storage()).selective.maxFileBytes).toBeNull()
    expect(readConnection(storage(), true).selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
    expect(MOBILE_MAX_FILE_BYTES).toBe(50 * 1024 * 1024)

    const noCap = storage({ [CONNECTION_KEY]: { ...connected(), selective: { images: false } } })
    expect(readConnection(noCap, true).selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
  })

  it('keeps the cap a phone chose, including the choice to have none', () => {
    const none = connected()
    none.selective.maxFileBytes = null
    const local = storage()
    writeConnection(local, none)

    expect(readConnection(local, true).selective.maxFileBytes).toBeNull()
  })
})

describe('what a connection may say', () => {
  it('takes a record that is empty or points at an https server', () => {
    expect(connectionProblem(emptyConnection())).toBeNull()
    expect(connectionProblem(connected())).toBeNull()
    expect(connectionProblem({ ...connected(), serverUrl: 'http://localhost:8787' })).toBeNull()
  })

  it('refuses plain http to another machine', () => {
    expect(connectionProblem({ ...connected(), serverUrl: 'http://192.168.1.5:8787' })).toMatch(
      /Plain http/
    )
  })

  it('refuses a keychain id this plugin never mints', () => {
    expect(connectionProblem({ ...connected(), deviceTokenId: 'abele-brave-search' })).toMatch(
      /abele-sync-device-/
    )
  })
})

/**
 * The one-time move out of `data.json`. The keychain is per vault and per device, so a token id
 * whose token this keychain holds is the proof that the file is this device's own; a block that
 * arrived from anywhere else fails it, and its identity is dropped rather than adopted.
 */
describe('moving the connection out of data.json', () => {
  const legacy = {
    serverUrl: 'https://sync.example.com',
    vaultId: 'v1',
    deviceId: 'd1',
    deviceTokenId: 'abele-sync-device-abc',
    deviceName: 'Laptop',
    paused: true,
    selective: { video: false, excludedFolders: ['Archive'], maxFileBytes: 1024 },
    keySignature: { property: 'secret', value: 'yes' },
  }
  const holds = (id: string): boolean => id === 'abele-sync-device-abc'
  const holdsNothing = (): boolean => false

  it('takes the identity and the cap when this keychain holds the token', () => {
    const local = storage()

    const migration = migrateConnection(local, legacy, holds)

    expect(migration).toEqual({ outcome: 'moved', rewrite: true })
    expect(readConnection(local)).toMatchObject({
      serverUrl: 'https://sync.example.com',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-device-abc',
      deviceName: 'Laptop',
      paused: true,
      migrated: true,
    })
    expect(readConnection(local).selective).toMatchObject({
      video: false,
      excludedFolders: ['Archive'],
      maxFileBytes: 1024,
    })
  })

  it('drops the identity of a file this device did not write, and keeps what it syncs', () => {
    const local = storage()

    const migration = migrateConnection(local, legacy, holdsNothing, true)

    expect(migration).toEqual({ outcome: 'dropped', rewrite: true })
    const record = readConnection(local, true)
    expect(record).toMatchObject({ serverUrl: '', vaultId: '', deviceTokenId: '', migrated: true })
    expect(record.paused).toBe(false)
    // What it syncs is a starting point; the cap is this platform's, not the other device's.
    expect(record.selective.video).toBe(false)
    expect(record.selective.excludedFolders).toEqual(['Archive'])
    expect(record.selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
  })

  it('never asks the keychain for an id this plugin does not mint', () => {
    const asked: string[] = []
    const local = storage()

    migrateConnection(local, { ...legacy, deviceTokenId: 'abele-brave-search' }, (id) => {
      asked.push(id)
      return true
    })

    expect(asked).toEqual([])
    expect(readConnection(local).serverUrl).toBe('')
  })

  it('records a device nobody set up as moved too, so it never runs again', () => {
    const local = storage()

    expect(migrateConnection(local, undefined, holds)).toEqual({ outcome: 'fresh', rewrite: false })
    expect(readConnection(local)).toEqual({ ...emptyConnection(), migrated: true })
  })

  it('asks for no rewrite of a file that holds only what devices share', () => {
    const shared = { keySignature: legacy.keySignature }

    expect(migrateConnection(storage(), shared, holds)).toEqual({
      outcome: 'fresh',
      rewrite: false,
    })
  })

  it('does nothing once the record says it was moved', () => {
    const local = storage()
    writeConnection(local, { ...emptyConnection(), deviceName: 'Phone', migrated: true })

    expect(migrateConnection(local, legacy, holds)).toBeNull()
    expect(readConnection(local).deviceName).toBe('Phone')
    expect(readConnection(local).serverUrl).toBe('')
  })
})
