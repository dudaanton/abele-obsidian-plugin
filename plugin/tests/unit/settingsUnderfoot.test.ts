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

/** Run while a load reads what each tool says of itself: the await a reload makes after reading. */
const tools = vi.hoisted(() => ({ during: null as (() => void) | null }))
vi.mock('@/ai/tools', () => ({
  codeToolDescriptions: () => {
    tools.during?.()
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

function install(): AbeleConfig {
  saved = []
  loadData = async () => {
    if (disk.broken) return undefined
    return disk.file === null ? null : clone(disk.file)
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

describe('a settings file that has gone', () => {
  it('is written again by the next save, even one that changed nothing', async () => {
    const config = await settled()
    arrive(null)

    expect(await config.reloadSettings()).toBe(false)
    await config.saveSettings()

    expect(saved).toHaveLength(1)
    expect(onDisk().tasksFolder).toBe('Work')
  })
})

describe('a save while a pulled file waits for its reload', () => {
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
