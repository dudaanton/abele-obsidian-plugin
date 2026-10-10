import { takePendingTab } from '@/components/settings/settingsTab'
import { tokenSettingsFixture } from '../helpers/tokenSettingsFixture'
import { tokenUi } from '@/sync/tokenUi'
import { flushPromises } from '@vue/test-utils'
import { GlobalStore } from '@/stores/GlobalStore'
/**
 * The sync commands exist whether or not the agent is switched on.
 *
 * They used to be registered at the end of `registerAiFeatures()`, which only runs once the
 * agent is on — so on a fresh vault, the one most people sync, "Open deleted files" and the
 * rest were missing from the palette, and that command is the only way into the deleted-files
 * dialog. The ids are what a hotkey is bound to, so they are asserted exactly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

interface Command {
  id: string
  callback: () => void
}

/** The plugin without its constructor, with what `initSync` and the agent's switch touch. */
const aPlugin = () => {
  const plugin = Object.create(AbelePlugin.prototype) as AbelePlugin
  const commands: Command[] = []
  const ready: (() => void)[] = []
  const statusEl = document.createElement('div')
  Object.assign(statusEl, { toggle: vi.fn() })
  const app = GlobalStore.getInstance().app
  Object.assign(app.workspace, { onLayoutReady: (fn: () => void) => ready.push(fn) })
  Object.assign(plugin, {
    app,
    addCommand: (command: Command) => {
      commands.push(command)
      return command
    },
    addStatusBarItem: () => statusEl,
    registerDomEvent: vi.fn(),
    register: vi.fn(),
  })
  return { plugin, commands, ready }
}

const SYNC_IDS = ['sync-now', 'sync-pause-resume', 'sync-log', 'sync-deleted-files']

beforeEach(() => {
  useVault([])
})

afterEach(() => {
  tokenUi.value = null
  vi.restoreAllMocks()
})

describe('the sync commands', () => {
  it('are registered with the agent switched off', () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false } as AiSettings
    const registerAi = vi.spyOn(AbelePlugin.prototype, 'registerAiFeatures')
    const { plugin, commands } = aPlugin()

    plugin.syncAiFeatures()
    ;(plugin as unknown as { initSync(): void }).initSync()

    expect(registerAi).not.toHaveBeenCalled()
    expect(commands.map((c) => c.id)).toEqual(expect.arrayContaining(SYNC_IDS))
  })

  it('open what they name', async () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false } as AiSettings
    const token = tokenSettingsFixture()
    const runtime = token.bind()
    const { plugin, commands } = aPlugin()
    const app = GlobalStore.getInstance().app as any
    app.setting = { open: vi.fn(), openTabById: vi.fn() }
    ;(plugin as unknown as { initSync(): void }).initSync()
    const run = (id: string) => commands.find((c) => c.id === id)?.callback()
    run('sync-now')
    run('sync-log')
    run('sync-deleted-files')
    await flushPromises()
    expect(runtime.sync).toHaveBeenCalledOnce()
    expect(app.setting.open).toHaveBeenCalledOnce()
    expect(app.setting.openTabById).toHaveBeenCalledWith('abele')
    expect(takePendingTab()).toBe('sync')
    expect(GlobalStore.getInstance().deletedFilesModalOpened.value).toBe(true)
  })

  it('says sync is paused when Sync now is run from the palette while it is', () => {
    const token = tokenSettingsFixture()
    const runtime = token.bind()
    token.registry.setPaused(token.id, true)
    token.ui.refresh()
    Notice.shown.length = 0
    try {
      const { plugin, commands } = aPlugin()
      ;(plugin as unknown as { initSync(): void }).initSync()
      commands.find((c) => c.id === 'sync-now')?.callback()
      expect(Notice.shown).toEqual(['Sync is paused. Resume it to sync this device.'])
      expect(runtime.sync).not.toHaveBeenCalled()
    } finally {
      tokenUi.value = null
    }
  })
})
