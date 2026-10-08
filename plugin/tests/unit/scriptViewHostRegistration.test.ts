import { afterEach, describe, expect, it, vi } from 'vitest'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScriptViewService } from '@/scripting/view/ScriptViewService'
import { defaultViewHost } from '@/scripting/view/host'
import { useVault } from '../helpers/testEnv'

// The view type exists even when the script index is off. Direct reader/slide runs and
// restored leaves must get the same host, without relying on a later AI startup callback.
afterEach(() => {
  ScriptViewService.destroy()
  vi.restoreAllMocks()
})

describe('script view host registration', () => {
  it.each([false, true])('registers the host with script indexing enabled=%s', (enabled) => {
    ScriptViewService.destroy()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled, scriptsEnabled: enabled }
    const plugin = Object.create(AbelePlugin.prototype)
    Object.assign(plugin, {
      app: useVault([]),
      registerView: vi.fn(),
      registerExtensions: vi.fn(),
      register: vi.fn(),
    })
    plugin.registerViews()
    expect(defaultViewHost()).toBe(ScriptViewService.getInstance())
  })
})
