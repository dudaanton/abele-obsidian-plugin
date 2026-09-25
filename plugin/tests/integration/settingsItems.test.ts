/**
 * Changing one item of a list setting — an agent, a header button, an automation — without
 * handing the whole list back.
 *
 * Before this, adding a button or renaming an agent meant reading the whole list and writing it
 * back with one thing changed: long, slow, and one dropped field away from losing the rest. The
 * same `write_settings` tool, under the same mode, now takes an `op` and works on one item,
 * addressed by its id or its name as well as by its place in the list.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createReadSettingsTool, createWriteSettingsTool } from '@/ai/tools/SettingsTools'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { Journal } from '@/entities/Journal'
import { useVault } from '../helpers/testEnv'

const read = createReadSettingsTool()
const write = createWriteSettingsTool()

async function answer(tool: typeof read, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('call-1', params)
  return result.content.map((part) => ('text' in part ? part.text : '')).join('')
}

let saved: number

function button(id: string, name: string) {
  return {
    id,
    name,
    icon: 'play',
    noteTypes: ['task'],
    scriptName: 'Run',
    params: {},
    enabled: true,
    iconOnly: false,
    allNotes: false,
    folders: [],
    conditions: [],
    conditionMode: 'all' as const,
  }
}

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.logsNotesTypes = ['journal', 'log']
  config.headerButtons = [button('b1', 'Start'), button('b2', 'Stop'), button('b3', 'Archive')]
  config.automations = []
  config.journals = [
    new Journal({ id: 'j1', name: 'Daily', type: 'daily', isDefault: true, recurrence: 'daily' }),
  ]
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    providers: [
      {
        id: 'p1',
        name: 'Provider',
        baseUrl: 'http://localhost/v1',
        apiKeyId: 'abele-key-1',
        models: [],
      },
    ],
    agents: [
      createAgent({ id: 'a1', name: 'Writer', prompts: [{ type: 'text', value: 'Be brief.' }] }),
      createAgent({ id: 'r1', name: 'Reviewer', utility: true }),
    ],
  }
  saved = 0
  config.saveSettings = vi.fn(async () => {
    saved++
  })
})

describe('addressing one item', () => {
  it('reads an item by its id or its name, not only by its place', async () => {
    expect(await answer(read, { path: 'ai.agents.r1.name' })).toContain('Reviewer')
    expect(await answer(read, { path: 'ai.agents.Writer.prompts' })).toContain('Be brief.')
    expect(await answer(read, { path: 'headerButtons.b2' })).toContain('"Stop"')
  })

  it('writes one field of an item by its id', async () => {
    await answer(write, { path: 'headerButtons.b2.icon', value: 'square' })

    expect(AbeleConfig.getInstance().headerButtons[1].icon).toBe('square')
    expect(saved).toBe(1)
  })

  it('says so when a name matches nothing', async () => {
    expect(await answer(read, { path: 'ai.agents.Nobody' })).toMatch(/not set|No item/)
  })

  /** A list too long to return whole still says what is in it, one line per item. */
  it('lists the items of a long list instead of refusing it', async () => {
    const config = AbeleConfig.getInstance()
    config.headerButtons = Array.from({ length: 60 }, (_, i) => ({
      ...button(`id${i}`, `Button ${i}`),
      params: { text: 'x'.repeat(100) },
    }))

    const text = await answer(read, { path: 'headerButtons' })
    expect(text).toContain('id59')
    expect(text).toContain('Button 59')
    expect(text).not.toContain('xxxxxxxxxx')
  })
})

describe('update: a partial patch', () => {
  it('changes only the fields it names, and answers with the item alone', async () => {
    const text = await answer(write, {
      op: 'update',
      path: 'headerButtons.b2',
      value: '{"name":"Halt","iconOnly":true}',
    })

    const [first, second, third] = AbeleConfig.getInstance().headerButtons
    expect(second).toMatchObject({ id: 'b2', name: 'Halt', iconOnly: true, scriptName: 'Run' })
    expect(first.name).toBe('Start')
    expect(third.name).toBe('Archive')
    expect(saved).toBe(1)
    expect(text).toContain('Halt')
    // The item, not the list around it.
    expect(text).not.toContain('Archive')
  })

  it('merges into a nested object rather than replacing it', async () => {
    await answer(write, {
      op: 'update',
      path: 'ai.agents.Writer',
      value: '{"toolModes":{"write_settings":"ask"}}',
    })

    const writer = AbeleConfig.getInstance().ai.agents[0]
    expect(writer.toolModes.write_settings).toBe('ask')
    expect(writer.toolModes.remember).toBe('auto')
    expect(writer.prompts).toHaveLength(1)
  })

  it('removes a field given as null', async () => {
    await answer(write, {
      op: 'update',
      path: 'ai.agents.a1',
      value: '{"fallbackModelId":"m2"}',
    })
    await answer(write, { op: 'update', path: 'ai.agents.a1', value: '{"fallbackModelId":null}' })

    expect('fallbackModelId' in AbeleConfig.getInstance().ai.agents[0]).toBe(false)
  })

  it('keeps the types of the fields it changes', async () => {
    const text = await answer(write, {
      op: 'update',
      path: 'headerButtons.b1',
      value: '{"noteTypes":"task"}',
    })

    expect(text).toContain('type')
    expect(AbeleConfig.getInstance().headerButtons[0].noteTypes).toEqual(['task'])
    expect(saved).toBe(0)
  })

  it('holds the interceptor rule, as a write by path does', async () => {
    expect(
      await answer(write, {
        op: 'update',
        path: 'ai.agents.a1',
        value: '{"interceptorAgentId":"a1"}',
      })
    ).toMatch(/own interceptor/)
    await answer(write, {
      op: 'update',
      path: 'ai.agents.a1',
      value: '{"interceptorAgentId":"r1"}',
    })
    expect(AbeleConfig.getInstance().ai.agents[0].interceptorAgentId).toBe('r1')
    await answer(write, { path: 'ai.agents.a1.interceptorAgentId', value: 'nobody' })
    expect(AbeleConfig.getInstance().ai.agents[0].interceptorAgentId).toBe('r1')
  })

  it('leaves a keychain id alone, whether echoed back hidden or written outright', async () => {
    await answer(write, {
      op: 'update',
      path: 'ai.providers.p1',
      value: '{"name":"Renamed","apiKeyId":"<hidden>"}',
    })
    const provider = AbeleConfig.getInstance().ai.providers[0]
    expect(provider.name).toBe('Renamed')
    expect(provider.apiKeyId).toBe('abele-key-1')

    const text = await answer(write, {
      op: 'update',
      path: 'ai.providers.p1',
      value: '{"apiKeyId":"other"}',
    })
    expect(text).toContain('not writable')
    expect(AbeleConfig.getInstance().ai.providers[0].apiKeyId).toBe('abele-key-1')
  })
})

describe('add', () => {
  it('appends an item, filled in and given an id, and answers with it', async () => {
    const text = await answer(write, {
      op: 'add',
      path: 'headerButtons',
      value: '{"name":"Done","scriptName":"Finish"}',
    })

    const buttons = AbeleConfig.getInstance().headerButtons
    expect(buttons).toHaveLength(4)
    const added = buttons[3]
    expect(added).toMatchObject({ name: 'Done', scriptName: 'Finish', icon: 'play', enabled: true })
    expect(added.id).toBeTruthy()
    expect(text).toContain(added.id)
    expect(text).not.toContain('Archive')
    expect(saved).toBe(1)
  })

  it('inserts at a place when given one', async () => {
    await answer(write, { op: 'add', path: 'logsNotesTypes', value: 'note', index: 0 })

    expect(AbeleConfig.getInstance().logsNotesTypes).toEqual(['note', 'journal', 'log'])
  })

  it('makes a whole agent out of a few fields', async () => {
    await answer(write, { op: 'add', path: 'ai.agents', value: '{"name":"Planner"}' })

    const planner = AbeleConfig.getInstance().ai.agents[2]
    expect(planner.name).toBe('Planner')
    expect(planner.id).toBeTruthy()
    expect(planner.permissionMode).toBe('confirm-all')
    expect(planner.toolModes.remember).toBe('auto')
  })

  it('makes a journal a journal, not a plain object', async () => {
    await answer(write, {
      op: 'add',
      path: 'journals',
      value: '{"name":"Weekly","type":"weekly","isDefault":false,"recurrence":"weekly"}',
    })

    const journals = AbeleConfig.getInstance().journals
    expect(journals[1]).toBeInstanceOf(Journal)
    expect(journals[1].id).toBeTruthy()
  })

  it('adds an automation as a whole rule', async () => {
    await answer(write, { op: 'add', path: 'automations', value: '{"name":"On done"}' })

    const rule = AbeleConfig.getInstance().automations[0]
    expect(rule).toMatchObject({ name: 'On done', enabled: true, event: 'task.completed' })
    expect(rule.id).toBeTruthy()
  })

  it('refuses an item of another kind than the list holds', async () => {
    const text = await answer(write, { op: 'add', path: 'logsNotesTypes', value: '{"a":1}' })

    expect(text).toContain('type')
    expect(saved).toBe(0)
  })

  it('adds only to a list', async () => {
    expect(await answer(write, { op: 'add', path: 'ai.chatFolder', value: 'x' })).toMatch(
      /not a list/
    )
  })
})

describe('remove and move', () => {
  it('removes one item by id and says which', async () => {
    const text = await answer(write, { op: 'remove', path: 'headerButtons.b2' })

    expect(AbeleConfig.getInstance().headerButtons.map((b) => b.id)).toEqual(['b1', 'b3'])
    expect(text).toContain('Stop')
    expect(saved).toBe(1)
  })

  it('removes a word from a list of words by the word itself', async () => {
    await answer(write, { op: 'remove', path: 'logsNotesTypes.log' })

    expect(AbeleConfig.getInstance().logsNotesTypes).toEqual(['journal'])
  })

  it('removes only an item of a list, never a setting', async () => {
    expect(await answer(write, { op: 'remove', path: 'ai.chatFolder' })).toMatch(/item of a list/)
    expect(saved).toBe(0)
  })

  it('moves an item to another place', async () => {
    const text = await answer(write, { op: 'move', path: 'headerButtons.b3', index: 0 })

    expect(AbeleConfig.getInstance().headerButtons.map((b) => b.id)).toEqual(['b3', 'b1', 'b2'])
    expect(text).toContain('0')
    expect(saved).toBe(1)
  })

  it('reaches a list inside an item', async () => {
    await answer(write, {
      op: 'add',
      path: 'ai.agents.Writer.prompts',
      value: '{"type":"note","value":"Prompts/Style.md"}',
    })

    expect(AbeleConfig.getInstance().ai.agents[0].prompts).toHaveLength(2)
  })
})

/** The whole-value write stays, and no longer eats a keychain id it was shown hidden. */
describe('writing a whole list', () => {
  it('still replaces the list, and keeps the keychain ids it echoed back hidden', async () => {
    const shown = await answer(read, { path: 'ai.providers' })
    const json = shown.slice(shown.indexOf('\n') + 1)
    const providers = JSON.parse(json)
    providers[0].name = 'Renamed'

    await answer(write, { path: 'ai.providers', value: JSON.stringify(providers) })

    const provider = AbeleConfig.getInstance().ai.providers[0]
    expect(provider.name).toBe('Renamed')
    expect(provider.apiKeyId).toBe('abele-key-1')
  })
})
