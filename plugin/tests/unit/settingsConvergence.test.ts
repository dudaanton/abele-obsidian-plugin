/**
 * Two devices sharing one `data.json` must settle, not ping-pong.
 *
 * The file syncs, and the later save wins. So a device that rewrites the file after reading
 * another device's copy — a migration persisted again, the same settings serialised in another
 * key order, a reload that saves on its way through — hands the file back, the other device
 * reads it and does the same, and neither ever stops. The rule that keeps it still: the
 * settings are written only when they changed in meaning, and a reload of the file this copy
 * already holds is no reload at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

let stored: unknown
let saved: Record<string, unknown>[]
let loadData: () => Promise<unknown>

function install(): AbeleConfig {
  saved = []
  loadData = async () => stored
  const config = AbeleConfig.getInstance()
  config.init({
    loadData: () => loadData(),
    saveData: async (data: unknown) => {
      // What reached the disk, as JSON — and what the next read of the file hands back.
      const copy = JSON.parse(JSON.stringify(data)) as Record<string, unknown>
      saved.push(copy)
      stored = copy
    },
    syncAiFeatures: vi.fn(),
  } as never)
  return config
}

/** The same value with every object's keys in the reverse order. */
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reordered(inner)])
  )
}

/** A settings file as this build writes it, so a load of it has nothing to migrate. */
async function settled(): Promise<AbeleConfig> {
  stored = { tasksFolder: 'Work' }
  const config = install()
  await config.loadSettings()
  await config.saveSettings()
  saved = []
  return config
}

beforeEach(() => {
  useVault([])
})

describe('a save', () => {
  it('writes nothing when the settings are what the file already holds', async () => {
    const config = await settled()

    await config.saveSettings()
    await config.saveSettings()

    expect(saved).toEqual([])
  })

  it('writes when something changed', async () => {
    const config = await settled()

    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(saved).toHaveLength(1)
    expect(saved[0].tasksFolder).toBe('Projects')
  })
})

describe('a reload', () => {
  it('of the same settings in another key order is not a change, and writes nothing', async () => {
    const config = await settled()
    const before = config.version.value

    stored = reordered(stored)

    expect(await config.reloadSettings()).toBe(false)
    expect(config.version.value).toBe(before)
    expect(saved).toEqual([])
  })

  it('of a changed file takes it, and writes nothing back', async () => {
    const config = await settled()
    const before = config.version.value

    stored = { ...(stored as object), tasksFolder: 'Elsewhere' }

    expect(await config.reloadSettings()).toBe(true)
    expect(config.tasksFolder).toBe('Elsewhere')
    expect(config.version.value).toBe(before + 1)
    expect(saved).toEqual([])
  })

  it('asked for twice for one change — by the sync and by Obsidian — happens once', async () => {
    const config = await settled()
    const before = config.version.value
    const told = vi.fn()
    const off = config.onSaved(told)

    stored = { ...(stored as object), tasksFolder: 'Elsewhere' }
    const answers = await Promise.all([config.reloadSettings(), config.reloadSettings()])
    off()

    expect(answers.filter(Boolean)).toHaveLength(1)
    expect(config.version.value).toBe(before + 1)
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('of a file caught half written reads it again after a moment, and is not unreadable', async () => {
    const config = await settled()
    const full = { ...(stored as object), tasksFolder: 'Elsewhere' }
    let reads = 0
    // The first read finds a file cut short; the sync finishes writing it 100 ms later.
    loadData = async () => (++reads === 1 ? undefined : full)

    expect(await config.reloadSettings()).toBe(true)

    expect(config.settingsUnreadable).toBe(false)
    expect(config.tasksFolder).toBe('Elsewhere')
    expect(reads).toBe(2)
  })

  it('of a file still unreadable after the second look leaves it unreadable, and unwritten', async () => {
    const config = await settled()
    loadData = async () => undefined

    await config.reloadSettings()
    config.tasksFolder = 'Projects'
    await config.saveSettings()

    expect(config.settingsUnreadable).toBe(true)
    expect(saved).toEqual([])
  })

  it('of a file that has gone keeps the settings in memory rather than going back to defaults', async () => {
    const config = await settled()
    const before = config.version.value

    stored = null

    expect(await config.reloadSettings()).toBe(false)
    expect(config.tasksFolder).toBe('Work')
    expect(config.version.value).toBe(before)
    expect(saved).toEqual([])
  })
})
