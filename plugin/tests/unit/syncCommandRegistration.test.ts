/**
 * The sync commands exist whether or not the agent is switched on.
 *
 * They used to be registered at the end of `registerAiFeatures()`, which only runs once the
 * agent is on — so on a fresh vault, the one most people sync, "Open deleted files" and the
 * rest were missing from the palette, and that command is the only way into the deleted-files
 * dialog. The ids are what a hotkey is bound to, so they are asserted exactly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { SyncService } from '@/sync/SyncService'
import { GlobalStore } from '@/stores/GlobalStore'
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
  Object.assign(plugin, {
    app: { workspace: { onLayoutReady: (fn: () => void) => ready.push(fn) } },
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
  vi.spyOn(SyncService.getInstance(), 'init').mockImplementation(() => {})
})

afterEach(() => {
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

  it('open what they name', () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false } as AiSettings
    const syncNow = vi.spyOn(SyncService.getInstance(), 'syncNow').mockResolvedValue()
    const { plugin, commands } = aPlugin()
    ;(plugin as unknown as { initSync(): void }).initSync()
    const run = (id: string) => commands.find((c) => c.id === id)?.callback()
    const store = GlobalStore.getInstance()
    store.syncLogModalOpened.value = false
    store.deletedFilesModalOpened.value = false

    run('sync-now')
    run('sync-log')
    run('sync-deleted-files')

    expect(syncNow).toHaveBeenCalledOnce()
    expect(store.syncLogModalOpened.value).toBe(true)
    expect(store.deletedFilesModalOpened.value).toBe(true)
  })
})
