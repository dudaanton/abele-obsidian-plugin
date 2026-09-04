/**
 * The two tools an agent changes the plugin's own settings with.
 *
 * They are two because they are two permissions — reading how a vault is configured is
 * ordinary, changing it is not — and each carries its own mode like every other tool. What is
 * asserted here is the part a mode cannot protect: that a write is one key at a time, that it
 * cannot invent a key or change one into another type, and that keys and keychain ids are
 * neither returned nor writable however they are asked for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createReadSettingsTool, createWriteSettingsTool } from '@/ai/tools/SettingsTools'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const read = createReadSettingsTool()
const write = createWriteSettingsTool()

/** What the tool answered, which is one block of text either way. */
async function answer(tool: typeof read, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

let saved: number

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.tasksFolder = 'Tasks'
  config.logsNotesTypes = ['journal', 'log']
  config.weekStartsOnMonday = true
  config.fireflyToken = 'a real token'
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    chatFolder: 'AI/Chats/{{name}}',
    secrets: [{ name: 'Anthropic', keyId: 'abele-key-1' }],
    braveSearchApiKey: 'brave-key',
    providers: [
      {
        id: 'p1',
        name: 'Provider',
        baseUrl: 'http://localhost/v1',
        apiKeyId: 'abele-key-1',
        models: [],
      },
    ],
    chatHistory: [{ path: 'AI/Chats/One.abchat', title: 'One', created: '2026-09-04' }],
  }
  saved = 0
  config.saveSettings = vi.fn(async () => {
    saved++
  })
})

describe('reading the settings', () => {
  it('lists every setting with what it holds', async () => {
    const text = await answer(read, {})

    expect(text).toContain('tasksFolder: "Tasks"')
    expect(text).toContain('ai.enabled: true')
    // A list says how long it is rather than spelling itself out.
    expect(text).toMatch(/ai\.agents: array of \d+/)
  })

  it('returns one setting whole when it is asked for by path', async () => {
    expect(await answer(read, { path: 'logsNotesTypes' })).toContain('"journal"')
    expect(await answer(read, { path: 'ai.chatFolder' })).toContain('AI/Chats/{{name}}')
  })

  it('walks into a list by index', async () => {
    expect(await answer(read, { path: 'ai.providers.0.name' })).toContain('Provider')
  })

  it('says so for a path that names nothing, rather than answering with nothing', async () => {
    const text = await answer(read, { path: 'tasksFolderr' })

    expect(text).toContain('No setting')
  })

  /** The whole reason this is two tools and not one object handed over. */
  it('never hands back a key, a keychain id or the chat index', async () => {
    const listed = await answer(read, {})
    expect(listed).not.toContain('ai.secrets')
    expect(listed).not.toContain('ai.chatHistory')
    expect(listed).not.toContain('fireflyToken')

    expect(await answer(read, { path: 'ai.secrets' })).toContain('not readable')
    expect(await answer(read, { path: 'fireflyToken' })).toContain('not readable')
    expect(await answer(read, { path: 'ai.chatHistory' })).toContain('not readable')
  })

  /** And not through a parent that happens to contain one, either. */
  it('takes the key out of anything it returns around it', async () => {
    const text = await answer(read, { path: 'ai.providers' })

    expect(text).toContain('Provider')
    expect(text).not.toContain('abele-key-1')
    expect(text).toContain('<hidden>')
  })
})

describe('changing a setting', () => {
  it('changes exactly the one it was given, and saves', async () => {
    const text = await answer(write, { path: 'tasksFolder', value: 'Work/Tasks' })

    expect(AbeleConfig.getInstance().tasksFolder).toBe('Work/Tasks')
    expect(saved).toBe(1)
    // Said out loud, both halves: a change nobody can see is a change nobody can undo.
    expect(text).toContain('"Tasks"')
    expect(text).toContain('"Work/Tasks"')
  })

  it('reads JSON where it is JSON, and plain words where it is not', async () => {
    await answer(write, { path: 'weekStartsOnMonday', value: 'false' })
    expect(AbeleConfig.getInstance().weekStartsOnMonday).toBe(false)

    await answer(write, { path: 'logsNotesTypes', value: '["journal","note"]' })
    expect(AbeleConfig.getInstance().logsNotesTypes).toEqual(['journal', 'note'])

    await answer(write, { path: 'tasksFolder', value: 'Tasks' })
    expect(AbeleConfig.getInstance().tasksFolder).toBe('Tasks')
  })

  it('reaches a setting inside the agent settings', async () => {
    await answer(write, { path: 'ai.chatFolder', value: 'Chats' })

    expect(AbeleConfig.getInstance().ai.chatFolder).toBe('Chats')
  })

  /** A typo that wrote would leave a key the plugin never reads sitting in the file for good. */
  it('refuses a setting that does not exist rather than inventing it', async () => {
    const text = await answer(write, { path: 'ai.temperatur', value: '0.5' })

    expect(text).toMatch(/not a setting|No setting/)
    expect((AbeleConfig.getInstance().ai as Record<string, unknown>).temperatur).toBeUndefined()
    expect(saved).toBe(0)
  })

  it('refuses a value of another type', async () => {
    const text = await answer(write, { path: 'tasksFolder', value: '["Tasks"]' })

    expect(text).toContain('type')
    expect(AbeleConfig.getInstance().tasksFolder).toBe('Tasks')
    expect(saved).toBe(0)
  })

  it('refuses a key, a keychain id and the chat index', async () => {
    for (const path of [
      'ai.secrets',
      'fireflyToken',
      'ai.chatHistory',
      'ai.providers.0.apiKeyId',
    ]) {
      expect(await answer(write, { path, value: '"x"' })).toContain('not writable')
    }

    expect(AbeleConfig.getInstance().fireflyToken).toBe('a real token')
    expect(saved).toBe(0)
  })

  it('has nothing to do without a path', async () => {
    expect(await answer(write, { path: '', value: '"x"' })).toContain('No setting named')
    expect(saved).toBe(0)
  })
})

/**
 * The two lists this tool works from are built out of the defaults rather than written out
 * again, so a setting added to `AbeleSettings` or `AiSettings` is reachable the day it exists.
 * This is the guard on that: it fails if the walk stops finding them.
 */
describe('the settings it knows about', () => {
  it('covers what the plugin actually has', async () => {
    const listed = await answer(read, {})

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === 'ai' || key === 'fireflyToken') continue
      expect(listed).toContain(`${key}:`)
    }
    for (const key of Object.keys(DEFAULT_AI_SETTINGS)) {
      if (['secrets', 'chatHistory', 'braveSearchApiKey'].includes(key)) continue
      expect(listed).toContain(`ai.${key}:`)
    }
  })
})
