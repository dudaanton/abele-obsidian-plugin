/**
 * `data.json` changing under the running plugin: pulled by a sync, broken, removed — and a save
 * or a reload landing in the middle of it.
 *
 * The file syncs to every device, so whatever one device makes of it every device gets. A
 * reload that falls back to defaults, a save that writes the settings loaded before a pull over
 * the pulled file, a file that is gone and never written again: each used to stay on one device,
 * and now it reaches all of them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createStore } from '@/secrets/storeFile'
import type { AiChatHistoryEntry } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const DIR = '.obsidian/plugins/abele'

/** Run after the settings snapshot is read, before the reload applies it. */
const tools = vi.hoisted(() => ({ during: null as (() => void) | null }))
vi.mock('@/ai/tools', () => ({
  codeToolDescriptions: () => {
    return {}
  },
}))

/**
 * The settings file on a disk of its own: what `loadData` reads, what `saveData` writes, and
 * the stat the adapter reports for it. `broken` stands for a file that is there and is not JSON.
 */
interface Disk {
  file: Record<string, unknown> | null
  broken: boolean
  mtime: number
}

let disk: Disk
let saved: Record<string, unknown>[]
let loadData: () => Promise<unknown>

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Another device's copy arriving: new bytes and a new stat, and no call to the plugin yet. */
function arrive(file: Record<string, unknown> | null): void {
  disk.file = file === null ? null : clone(file)
  disk.broken = false
  disk.mtime += 1000
}

/** The plugin's `onExternalSettingsChange`, for the installs that have one. */
let external: ReturnType<typeof vi.fn> | null = null

function install(): AbeleConfig {
  saved = []
  loadData = async () => {
    if (disk.broken) return undefined
    const snapshot = disk.file === null ? null : clone(disk.file)
    await Promise.resolve()
    tools.during?.()
    return snapshot
  }
  const config = AbeleConfig.getInstance()
  config.init({
    app: {
      vault: {
        configDir: '.obsidian',
        adapter: {
          stat: async (path: string) => {
            if (path !== `${DIR}/data.json`) return null
            if (disk.file === null && !disk.broken) return null
            return { type: 'file', size: 1, mtime: disk.mtime, ctime: 0 }
          },
        },
      },
    },
    manifest: { id: 'abele', dir: DIR },
    loadData: () => loadData(),
    saveData: async (data: unknown) => {
      const copy = clone(data) as Record<string, unknown>
      saved.push(copy)
      disk.file = copy
      disk.broken = false
      disk.mtime += 1
    },
    syncAiFeatures: vi.fn(),
    ...(external === null ? {} : { onExternalSettingsChange: external }),
  } as never)
  return config
}

/** A device whose settings file says `tasksFolder: Work` and holds nothing left to migrate. */
async function settled(): Promise<AbeleConfig> {
  disk = { file: { tasksFolder: 'Work' }, broken: false, mtime: 1000 }
  const config = install()
  await config.loadSettings()
  await config.saveSettings()
  saved = []
  return config
}

const onDisk = (): Record<string, unknown> => disk.file as Record<string, unknown>

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
  external = null
})

/** Lets whatever a finished step scheduled run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('startup before the connection has been moved', () => {
  it('does not strip a legacy identity when an initially unreadable file later becomes readable', async () => {
    const legacy = {
      serverUrl: 'https://legacy.example',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-device-legacy',
    }
    disk = { file: { sync: legacy }, broken: true, mtime: 1000 }
    const config = install()
    await config.loadSettings()
    arrive({ sync: legacy, tasksFolder: 'Work' })
    await config.reloadSettings()
    await config.saveSettings()
    expect(onDisk().sync).toMatchObject(legacy)
    expect(saved).toEqual([])
  })
  it('keeps legacy identity through startup rewrites and later saves until durable migration succeeds', async () => {
    const legacy = {
      serverUrl: 'https://legacy.example',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-device-legacy',
    }
    disk = { file: { tasksFolder: 'Work', sync: legacy }, broken: false, mtime: 1000 }
    const config = install()
    await config.loadSettings()
    expect(onDisk().sync).toMatchObject(legacy)
    expect(config.takeLoadedSync()?.sync).toMatchObject(legacy)
    config.busyDayThreshold = 9
    await config.saveSettings()
    expect(onDisk().sync).toMatchObject(legacy)
  })
})

describe('a pulled settings file that will not parse', () => {
  it('keeps the settings in memory, reloads nothing, and writes nothing over it', async () => {
    const config = await settled()
    const before = config.version.value
    disk.broken = true

    expect(await config.reloadSettings()).toBe(false)

    expect(config.tasksFolder).toBe('Work')
    expect(config.version.value).toBe(before)
    config.busyDayThreshold = 9
    await config.saveSettings()
    expect(saved).toEqual([])
    expect(config.settingsUnreadable).toBe(true)
  })

  it('tells the person once, without asking them to delete a file that syncs', async () => {
    const config = await settled()
    disk.broken = true

    await config.reloadSettings()
    await config.saveSettings()
    await config.saveSettings()

    const told = Notice.shown.filter((message) => message.includes('settings file'))
    expect(told).toHaveLength(1)
    expect(told[0]).not.toMatch(/delete it/i)
    expect(told[0]).toMatch(/version history/i)
  })

  it('is taken as soon as a readable one arrives, and saves go through again', async () => {
    const config = await settled()
    disk.broken = true
    await config.reloadSettings()

    arrive({ tasksFolder: 'Elsewhere' })
    expect(await config.reloadSettings()).toBe(true)
    config.busyDayThreshold = 9
    await config.saveSettings()

    expect(config.settingsUnreadable).toBe(false)
    expect(onDisk().tasksFolder).toBe('Elsewhere')
    expect(onDisk().busyDayThreshold).toBe(9)
  })
})

describe('a pulled file that would not parse, followed by one that does', () => {
  it('keeps this device’s key store, and a change made meanwhile, on top of it', async () => {
    const config = await settled()
    const { file: store } = await createStore('passphrase', {}, { iterations: 1000 })
    config.secretStore = store
    await config.saveSettings()
    disk.broken = true
    await config.reloadSettings()
    config.busyDayThreshold = 9
    await config.saveSettings()

    // Put back from an older version, or written by an older build: no store in it.
    arrive({ tasksFolder: 'Elsewhere' })
    expect(await config.reloadSettings()).toBe(true)

    expect(config.tasksFolder).toBe('Elsewhere')
    expect(config.busyDayThreshold).toBe(9)
    expect(config.secretStore).toEqual(store)
    expect(onDisk().secretStore).toEqual(store)
    expect(onDisk().busyDayThreshold).toBe(9)
  })
})

describe('a settings file that has gone', () => {
  it('is written again by the next save, even one that changed nothing', async () => {
    const config = await settled()
    arrive(null)

    expect(await config.reloadSettings()).toBe(false)
    await config.saveSettings()

    expect(saved).toHaveLength(1)
    expect(onDisk().tasksFolder).toBe('Work')
  })

  it('is written again when the plugin unloads before any save', async () => {
    const config = await settled()
    arrive(null)
    await config.reloadSettings()

    config.destroy()
    await settle()

    expect(saved).toHaveLength(1)
    expect(onDisk().tasksFolder).toBe('Work')
  })

  it('is not written at unload when it is there', async () => {
    const config = await settled()

    config.destroy()
    await settle()

    expect(saved).toEqual([])
  })
})

describe('a save while a pulled file waits for its reload', () => {
  it('keeps nested provider and array-element edits on top of independently arriving settings', async () => {
    const config = await settled()
    config.ai.providers = [
      { id: 'sample', name: 'Sample', baseUrl: 'https://old.example', apiKeyId: '', models: [] },
    ]
    config.links = [
      {
        id: 'sample-link',
        name: 'Sample',
        type: 'script',
        scriptName: 'Original',
        commandId: '',
        waitForSync: false,
      },
    ]
    config.headerButtons = [
      {
        id: 'sample-button',
        name: 'Sample button',
        icon: 'star',
        noteTypes: ['sample'],
        scriptName: 'Original',
        params: { mode: 'old' },
      },
    ]
    await config.saveSettings()
    const before = clone(onDisk())
    config.ai.providers[0].baseUrl = 'https://local.example'
    config.links[0].scriptName = 'Local'
    config.headerButtons[0].params.mode = 'local'
    config.headerButtons[0].noteTypes.push('another')
    arrive({ ...before, busyDayThreshold: 9 })
    await config.saveSettings()
    expect(config.ai.providers[0].baseUrl).toBe('https://local.example')
    expect(config.links[0].scriptName).toBe('Local')
    expect(config.headerButtons[0].params.mode).toBe('local')
    expect(config.headerButtons[0].noteTypes).toEqual(['sample', 'another'])
    expect(onDisk().busyDayThreshold).toBe(9)
    expect((onDisk().ai as { providers: { baseUrl: string }[] }).providers[0].baseUrl).toBe(
      'https://local.example'
    )
  })
  it('takes the pulled change in and puts its own on top, rather than writing over it', async () => {
    const config = await settled()
    arrive({ ...onDisk(), busyDayThreshold: 9 })

    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(onDisk().tasksFolder).toBe('Projects')
    expect(onDisk().busyDayThreshold).toBe(9)
    expect(config.busyDayThreshold).toBe(9)
  })

  it('leaves the reload that follows to finish the rest of it, once', async () => {
    const config = await settled()
    arrive({ ...onDisk(), busyDayThreshold: 9 })
    config.tasksFolder = 'Projects'
    await config.saveSettings()

    // The reload the sync and Obsidian ask for next: the secret store and the AI features are
    // reopened on the arrived settings, so the first says it reloaded; the second has nothing.
    expect(await config.reloadSettings()).toBe(true)
    expect(await config.reloadSettings()).toBe(false)
    expect(config.busyDayThreshold).toBe(9)
    expect(config.tasksFolder).toBe('Projects')
  })

  it('asks for the rest of the reload itself, once, when nothing else would', async () => {
    external = vi.fn()
    const config = await settled()
    arrive({ ...onDisk(), busyDayThreshold: 9 })

    config.tasksFolder = 'Projects'
    await config.saveSettings()
    await settle()

    expect(external).toHaveBeenCalledTimes(1)
    config.tasksFolder = 'Elsewhere'
    await config.saveSettings()
    await settle()
    expect(external).toHaveBeenCalledTimes(1)
  })

  it('waits for a reload already running, and keeps the change it was asked to save', async () => {
    const config = await settled()
    arrive({ ...onDisk(), busyDayThreshold: 9 })
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const read = loadData
    loadData = async () => {
      await held
      return read()
    }

    const reload = config.reloadSettings()
    config.tasksFolder = 'Projects'
    const save = config.saveSettings()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saved).toEqual([])
    loadData = read
    release()
    await Promise.all([reload, save])

    expect(config.tasksFolder).toBe('Projects')
    expect(config.busyDayThreshold).toBe(9)
    expect(onDisk().tasksFolder).toBe('Projects')
    expect(onDisk().busyDayThreshold).toBe(9)
  })

  it('does not write over a file it finds half written, and keeps the change in memory', async () => {
    vi.useFakeTimers()
    try {
      const config = await settled()
      disk.broken = true
      disk.mtime += 1000
      config.tasksFolder = 'Projects'

      const save = config.saveSettings()
      await vi.advanceTimersByTimeAsync(1000)
      await save

      expect(saved).toEqual([])
      expect(config.tasksFolder).toBe('Projects')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the synced key store in an arriving file', () => {
  it('is kept, and written back, when the file that arrived holds none', async () => {
    const config = await settled()
    const { file: store } = await createStore('passphrase', {}, { iterations: 1000 })
    config.secretStore = store
    await config.saveSettings()

    arrive({ tasksFolder: 'Elsewhere' })
    expect(await config.reloadSettings()).toBe(true)

    expect(config.tasksFolder).toBe('Elsewhere')
    expect(config.secretStore).toEqual(store)
    expect(onDisk().secretStore).toEqual(store)
    expect(onDisk().tasksFolder).toBe('Elsewhere')
  })

  it('is turned off by a file that says so', async () => {
    const config = await settled()
    const { file: store } = await createStore('passphrase', {}, { iterations: 1000 })
    config.secretStore = store
    await config.saveSettings()

    const off = { off: true, id: store.id }
    arrive({ tasksFolder: 'Work', secretStore: off })
    await config.reloadSettings()

    expect(config.secretStore).toEqual(off)
    expect(onDisk().secretStore).toEqual(off)
  })

  it('is taken whole when it says off, whatever this device changed in its store meanwhile', async () => {
    const config = await settled()
    const { file: store } = await createStore('passphrase', {}, { iterations: 1000 })
    config.secretStore = store
    await config.saveSettings()

    // A write of this device's store, queued behind the reload of a file that turned it off.
    config.secretStore = { ...store, entries: { 'abele-key': { at: 1 } } }
    const off = { off: true, id: store.id }
    arrive({ tasksFolder: 'Work', secretStore: off })
    await config.reloadSettings()

    expect(config.secretStore).toEqual(off)
    expect(onDisk().secretStore).toEqual(off)
  })
})

describe('the chat index during a reload', () => {
  it('keeps a chat listed while the reload was under way', async () => {
    const config = await settled()
    arrive({ ...onDisk(), tasksFolder: 'Elsewhere' })
    const added: AiChatHistoryEntry = { path: 'AI/Chats/New.abchat', title: 'New', created: 'x' }
    // A chat started while the reload was under way: `ChatStorage` replaces the array.
    tools.during = () => {
      config.ai.chatHistory = [...config.ai.chatHistory, added]
    }
    try {
      await config.reloadSettings()
    } finally {
      tools.during = null
    }

    expect(config.ai.chatHistory.map((entry) => entry.path)).toContain(added.path)
  })
})
