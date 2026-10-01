import { afterEach, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import * as tools from '@/ai/tools'
import { SHIPPED_TOOL_DESCRIPTIONS } from '@/ai/tools/toolDescriptionOverrides'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  AbeleConfig.getInstance().destroy()
  vi.restoreAllMocks()
})
it.each(['fresh', 'current', 'legacy'] as const)(
  'loads %s settings without constructing executable tools',
  async (kind) => {
    useVault([])
    const config = AbeleConfig.getInstance()
    const catalog = vi.spyOn(tools, 'codeToolDescriptions')
    const stored =
      kind === 'fresh'
        ? null
        : {
            ai: {
              ...DEFAULT_AI_SETTINGS,
              prompts: {
                ...DEFAULT_AI_SETTINGS.prompts,
                toolDescriptions: kind === 'legacy' ? { ls: SHIPPED_TOOL_DESCRIPTIONS.ls[0] } : {},
              },
            },
          }
    config.init({
      loadData: async () => stored,
      saveData: async () => {},
      syncAiFeatures() {},
    } as never)
    const times: number[] = []
    for (let i = 0; i < 25; i++) {
      const start = performance.now()
      await config.loadSettings()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    console.info(`${kind}: catalogs=${catalog.mock.calls.length}, median=${times[12].toFixed(3)}ms`)
    expect(catalog).not.toHaveBeenCalled()
    expect(config.ai.prompts.toolDescriptions).toEqual({})
  }
)
