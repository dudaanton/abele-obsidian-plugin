/**
 * Abele's own `data.json` syncs like any other plugin's, so nothing in it may name this device.
 *
 * The connection moved to local storage (`sync/connection.ts`); this is the guard that keeps it
 * there. A settings file an older build wrote still carries the server, the vault, the device,
 * the keychain name of its token and the size cap — and once the file travels, any of them
 * written back would make the next device sync as this one, or take this device's cap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import { ConnectionKeeper } from '@/sync/connectionKeeper'
import type { FakeApp } from '../helpers/fakeVault'

const IDENTITY = ['serverUrl', 'vaultId', 'deviceId', 'deviceTokenId', 'maxFileBytes']

let stored: unknown
let saved: unknown[]
let app: FakeApp

function install(): void {
  saved = []
  AbeleConfig.getInstance().init({
    loadData: async () => stored,
    saveData: async (data: unknown) => void saved.push(JSON.parse(JSON.stringify(data))),
    syncAiFeatures: vi.fn(),
  } as never)
}

/** Every key anywhere in a JSON value, however deep. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
}

/** A settings file as the build before the move wrote it: the whole connection inside. */
const OLD_FORMAT = {
  tasksFolder: 'Work',
  sync: {
    serverUrl: 'https://sync.example.com',
    vaultId: 'v-1',
    deviceId: 'd-1',
    deviceTokenId: 'abele-sync-device-1',
    deviceName: 'Laptop',
    paused: false,
    selective: { maxFileBytes: 1024, kinds: { images: true } },
    keySignature: { property: 'secret', value: 'yes' },
  },
}

beforeEach(() => {
  app = useVault([])
})

describe('a saved data.json', () => {
  it('holds no field that names this device, after a load and a save', async () => {
    stored = OLD_FORMAT
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    // Complete the real startup order before asking what data.json is allowed to export.
    await new ConnectionKeeper(() => undefined).open(app as never)
    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(saved.length).toBeGreaterThan(0)
    for (const file of saved) {
      expect(keysOf(file).filter((key) => IDENTITY.includes(key))).toEqual([])
    }
    // What is shared is still there.
    expect(saved.at(-1)).toMatchObject({
      tasksFolder: 'Projects',
      sync: { keySignature: { property: 'secret', value: 'yes' } },
    })
  })

  it('holds none after a reload of a file another device wrote in the old format either', async () => {
    stored = { tasksFolder: 'Work' }
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    stored = OLD_FORMAT
    await config.reloadSettings()
    config.tasksFolder = 'Elsewhere'
    await config.saveSettings()

    expect(saved.length).toBeGreaterThan(0)
    for (const file of saved) {
      expect(keysOf(file).filter((key) => IDENTITY.includes(key))).toEqual([])
    }
  })
})
