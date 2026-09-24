/**
 * Tool descriptions in the settings: only the ones the person changed.
 *
 * Every tool description the plugin shipped as a default used to be saved into `data.json` with
 * the rest of the settings, and a saved description replaces the tool's own. So a vault kept
 * the descriptions of the version it first saved with, and an agent there never saw a tool
 * described better later — `read` learning to number lines was the case that showed it. Now a
 * saved description is an override: kept only when it differs from what the tool says itself
 * and from anything that was ever shipped as a default.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import {
  SHIPPED_TOOL_DESCRIPTIONS,
  isDefaultDescription,
  pruneToolDescriptions,
} from '@/ai/tools/toolDescriptionOverrides'
import { codeToolDescriptions, createAgentTools, getToolRegistry } from '@/ai/tools'
import { collectEntries } from '@/transfer/entries'
import { useVault } from '../helpers/testEnv'

const OLD_READ =
  'Read the content of a file. Only files within the current workspace scope are accessible.'

/** What a settings file saved by an older version holds: every shipped default, verbatim. */
const everyOldDefault = (): Record<string, string> =>
  Object.fromEntries(Object.entries(SHIPPED_TOOL_DESCRIPTIONS).map(([k, v]) => [k, v[0]]))

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS }
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

describe('telling a default from an override', () => {
  it('knows every default shipped before, whitespace aside', () => {
    expect(isDefaultDescription('read', OLD_READ)).toBe(true)
    expect(isDefaultDescription('read', `  ${OLD_READ.replace(/ /g, '\n ')}  `)).toBe(true)
    expect(isDefaultDescription('read', 'Read one of my notes.')).toBe(false)
  })

  it('knows the description the tool gives itself now', () => {
    expect(isDefaultDescription('ls', 'Anything at all', 'Anything  at\nall')).toBe(true)
  })

  it('knows the shipped defaults of the tools that had one', () => {
    for (const name of ['read', 'find', 'edit', 'fetch', 'delegate', 'read_tasks']) {
      expect(SHIPPED_TOOL_DESCRIPTIONS[name]?.length, name).toBeGreaterThan(0)
    }
  })
})

describe('pruning saved descriptions', () => {
  it('drops shipped and current defaults and empty ones, and keeps what the person wrote', () => {
    const { kept, dropped } = pruneToolDescriptions(
      { ...everyOldDefault(), find: 'Search my notes, carefully.', ls: '', write: 'W' },
      { write: 'W' }
    )
    expect(kept).toEqual({ find: 'Search my notes, carefully.' })
    // Every shipped one but `find`, which the person rewrote, and `write`, the current default.
    expect(dropped).toBe(Object.keys(SHIPPED_TOOL_DESCRIPTIONS).length)
  })

  it('has nothing left to drop the second time', () => {
    const once = pruneToolDescriptions({ ...everyOldDefault(), find: 'Mine' }).kept
    expect(pruneToolDescriptions(once)).toEqual({ kept: { find: 'Mine' }, dropped: 0 })
  })
})

describe('the settings on load', () => {
  const load = async (stored: unknown) => {
    const saved: unknown[] = []
    AbeleConfig.getInstance().init({
      loadData: async () => stored,
      saveData: async (data: unknown) => void saved.push(data),
      syncAiFeatures: vi.fn(),
    } as never)
    await AbeleConfig.getInstance().loadSettings()
    return saved as Array<{ ai: { prompts: { toolDescriptions: Record<string, string> } } }>
  }

  const settingsWith = (toolDescriptions: Record<string, string>) => ({
    ai: {
      ...DEFAULT_AI_SETTINGS,
      prompts: { ...DEFAULT_AI_SETTINGS.prompts, toolDescriptions },
    },
  })

  it('keep only the overrides and write that back once', async () => {
    const saved = await load(settingsWith({ ...everyOldDefault(), find: 'Mine' }))

    expect(AbeleConfig.getInstance().ai.prompts.toolDescriptions).toEqual({ find: 'Mine' })
    expect(saved.at(-1)?.ai.prompts.toolDescriptions).toEqual({ find: 'Mine' })

    const again = await load(saved.at(-1))
    expect(again).toHaveLength(0)
  })

  it('drop a saved copy of what the tool now says itself', async () => {
    const ls = codeToolDescriptions().ls
    await load(settingsWith({ ls }))
    expect(AbeleConfig.getInstance().ai.prompts.toolDescriptions).toEqual({})
  })

  it('never write over a settings file that could not be read', async () => {
    const saved = await load(undefined)
    expect(saved).toHaveLength(0)
  })

  it('no longer ship any description as a setting', () => {
    expect(DEFAULT_AI_SETTINGS.prompts.toolDescriptions).toEqual({})
  })
})

describe('what an agent is told', () => {
  it('is the tool’s own description unless the person changed it', () => {
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      prompts: { ...DEFAULT_AI_SETTINGS.prompts, toolDescriptions: { read: OLD_READ, ls: 'Mine' } },
    }
    const tools = createAgentTools()
    const by = (name: string) => tools.find((t) => t.name === name)!.description

    expect(by('read')).toBe(codeToolDescriptions().read)
    expect(by('ls')).toBe('Mine')
  })

  it('is what the settings screen shows as the default', () => {
    const registry = getToolRegistry()
    const read = registry.find((t) => t.name === 'read')!
    expect(read.description).toBe(codeToolDescriptions().read)
  })
})

describe('a transfer', () => {
  it('carries only the overrides', () => {
    const entries = collectEntries({
      ...settingsOf({ ...everyOldDefault(), find: 'Mine' }),
    } as never).filter((e) => e.section === 'ai-prompts')

    const data = entries[0].data as { prompts: { toolDescriptions: Record<string, string> } }
    expect(data.prompts.toolDescriptions).toEqual({ find: 'Mine' })
  })
})

function settingsOf(toolDescriptions: Record<string, string>) {
  return {
    ai: {
      ...DEFAULT_AI_SETTINGS,
      prompts: { ...DEFAULT_AI_SETTINGS.prompts, toolDescriptions },
    },
  }
}
