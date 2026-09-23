/**
 * `data.json` is changed by more than this running copy of the plugin.
 *
 * Sync carries it between devices, and every device rewrites the whole file on its own — the
 * chat index lives in it. A copy that never reads the file again after startup writes its old
 * settings back over whatever arrived, and the next launch anywhere loads the old ones: header
 * buttons configured on one device vanished that way.
 *
 * And a file that cannot be read is not an empty one. Loading defaults over it and saving them
 * straight away wiped every setting for good; the file is left alone instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, MAP_TOOL_MODES } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'

interface FakePlugin {
  loadData: () => Promise<unknown>
  saveData: (data: unknown) => Promise<void>
  syncAiFeatures: () => void
}

let stored: unknown
let saved: Array<Record<string, unknown>>

function install(): FakePlugin {
  saved = []
  const plugin: FakePlugin = {
    loadData: async () => stored,
    saveData: async (data) => void saved.push(data as Record<string, unknown>),
    syncAiFeatures: vi.fn(),
  }
  AbeleConfig.getInstance().init(plugin as never)
  return plugin
}

/** Settings with nothing left to migrate, so a load writes nothing of its own. */
function settingsWith(headerButtons: HeaderButtonDefinition[]) {
  const toolModes = { ...MAP_TOOL_MODES }
  return {
    headerButtons,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      agents: [
        createAgent({ id: 'a1', name: 'Default', toolModes }),
        createAgent({ id: 'c1', toolModes: { ...toolModes } }),
      ],
      defaultAgentId: 'a1',
      commentAgentId: 'c1',
    },
  }
}

const button: HeaderButtonDefinition = {
  id: 'b1',
  name: 'Create task',
  icon: 'list-plus',
  noteTypes: ['project'],
  scriptName: 'Create task for note',
  params: { source: '{{path}}' },
}

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
})

describe('a settings file changed from outside', () => {
  it('is read again, so the next save carries what arrived', async () => {
    stored = settingsWith([])
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    stored = settingsWith([button])
    await config.reloadSettings()
    await config.saveSettings()

    expect(config.headerButtons).toMatchObject([button])
    expect(saved.at(-1)?.headerButtons).toMatchObject([button])
  })

  it('tells whatever shows settings that they changed', async () => {
    stored = settingsWith([])
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    const before = config.version.value

    stored = settingsWith([button])
    await config.reloadSettings()

    expect(config.version.value).toBeGreaterThan(before)
  })
})

describe('a save', () => {
  it('tells whatever shows settings that they changed', async () => {
    stored = settingsWith([])
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()
    const before = config.version.value

    await config.saveSettings()

    expect(config.version.value).toBeGreaterThan(before)
  })

  it('does not throw when the plugin unloads while it is being written', async () => {
    stored = settingsWith([])
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    const saving = config.saveSettings()
    config.destroy()

    await expect(saving).resolves.toBeUndefined()
    expect(saved).toHaveLength(1)
  })
})

describe('a settings file that cannot be read', () => {
  // Obsidian hands back `undefined` when `data.json` exists but is not JSON — half written by
  // a sync, cut short by a crash — and `null` only when there is no file at all.
  it('is not overwritten with defaults at load', async () => {
    stored = undefined
    install()

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toEqual([])
  })

  it('is not overwritten by a later save either, and the person is told', async () => {
    stored = undefined
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    await config.saveSettings()

    expect(saved).toEqual([])
    expect(Notice.shown.some((m) => m.includes('settings'))).toBe(true)
  })

  it('is written to again once it reads', async () => {
    stored = undefined
    install()
    const config = AbeleConfig.getInstance()
    await config.loadSettings()

    stored = settingsWith([button])
    await config.reloadSettings()
    await config.saveSettings()

    expect(saved.at(-1)?.headerButtons).toMatchObject([button])
  })
})

describe('no settings file at all', () => {
  it('is a fresh install, and its defaults are written', async () => {
    stored = null
    install()

    await AbeleConfig.getInstance().loadSettings()

    expect(saved).toHaveLength(1)
  })
})

describe('header buttons saved before they could be switched off, placed or shown everywhere', () => {
  it('load as they behaved: on, labelled, shown by type only', async () => {
    const old = { id: 'b1', name: 'Fetch', icon: 'play', noteTypes: ['movie'], scriptName: 'Fetch' }
    stored = settingsWith([old as HeaderButtonDefinition])
    install()

    await AbeleConfig.getInstance().loadSettings()

    expect(AbeleConfig.getInstance().headerButtons).toEqual([
      {
        ...old,
        params: {},
        enabled: true,
        iconOnly: false,
        allNotes: false,
        folders: [],
      },
    ])
  })
})
