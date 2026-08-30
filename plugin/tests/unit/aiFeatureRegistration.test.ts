/**
 * When the agent's commands and ribbon icon appear.
 *
 * They are registered from a setting, and the setting is off on a fresh install — so the first
 * thing anyone does is turn it on. That used to register nothing until Obsidian was restarted,
 * because the only call was in `onload`: the switch looked as if it had not taken, and there
 * was no way to open the agent at all. The same went for scripts, which are a second switch
 * behind the first.
 *
 * Registering is one way only. Obsidian gives nothing back to remove a command or a ribbon
 * icon, so this asks that it happens once and no more, rather than that it can be undone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { ScriptService } from '@/scripting/ScriptService'
import { useVault } from '../helpers/testEnv'

/** The plugin without its constructor: what is being asked about is one method of it. */
const aPlugin = () => {
  const plugin = Object.create(AbelePlugin.prototype) as AbelePlugin
  const ready: (() => void)[] = []
  ;(plugin as unknown as { app: unknown }).app = {
    workspace: { onLayoutReady: (fn: () => void) => ready.push(fn) },
  }
  return { plugin, ready }
}

const settings = (ai: Partial<AiSettings>) => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, ...ai } as AiSettings
}

let registered: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useVault([])
  registered = vi.spyOn(AbelePlugin.prototype, 'registerAiFeatures').mockImplementation(() => {})
})

describe('the agent being switched on', () => {
  it('puts nothing up while the setting is off', () => {
    settings({ enabled: false })
    const { plugin } = aPlugin()

    plugin.syncAiFeatures()

    expect(registered).not.toHaveBeenCalled()
  })

  it('puts the commands and the icon up as soon as it is on', () => {
    settings({ enabled: true })
    const { plugin } = aPlugin()

    plugin.syncAiFeatures()

    expect(registered).toHaveBeenCalledOnce()
  })

  /** Every settings save asks again, and Obsidian cannot take a command back. */
  it('does not put them up a second time when asked again', () => {
    settings({ enabled: true })
    const { plugin } = aPlugin()

    plugin.syncAiFeatures()
    plugin.syncAiFeatures()
    plugin.syncAiFeatures()

    expect(registered).toHaveBeenCalledOnce()
  })

  it('puts them up on the save that turns it on, not before', () => {
    settings({ enabled: false })
    const { plugin } = aPlugin()

    plugin.syncAiFeatures()
    settings({ enabled: true })
    plugin.syncAiFeatures()

    expect(registered).toHaveBeenCalledOnce()
  })
})

describe('scripts, the switch behind the switch', () => {
  it('are left alone while they are off', () => {
    settings({ enabled: true, scriptsEnabled: false })
    const { plugin, ready } = aPlugin()

    plugin.syncAiFeatures()

    expect(ready).toHaveLength(0)
  })

  it('are read once the setting is on', () => {
    const init = vi.spyOn(ScriptService.getInstance(), 'init').mockImplementation(() => {})
    settings({ enabled: true, scriptsEnabled: true })
    const { plugin, ready } = aPlugin()

    plugin.syncAiFeatures()
    for (const fn of ready) fn()

    expect(init).toHaveBeenCalledOnce()
  })

  it('are not read again on the next save', () => {
    const init = vi.spyOn(ScriptService.getInstance(), 'init').mockImplementation(() => {})
    settings({ enabled: true, scriptsEnabled: true })
    const { plugin, ready } = aPlugin()

    plugin.syncAiFeatures()
    plugin.syncAiFeatures()
    for (const fn of ready) fn()

    expect(init).toHaveBeenCalledOnce()
  })
})

describe('saving the settings', () => {
  /** The one road every settings change takes, which is what makes the switch immediate. */
  it('asks the plugin to catch up with what was just saved', async () => {
    const syncAiFeatures = vi.fn()
    const config = AbeleConfig.getInstance()
    // Saving writes out the whole settings object, so it needs a whole one to write.
    config.applySettings(undefined)
    config.plugin = { saveData: vi.fn(), syncAiFeatures } as never

    await config.saveSettings()

    expect(syncAiFeatures).toHaveBeenCalledOnce()
  })
})
