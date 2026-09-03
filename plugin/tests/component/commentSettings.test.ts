/**
 * Where a comment chat's agent and folder are chosen.
 *
 * The agent list deliberately includes utility agents: the seeded "Comment" agent is one, so a
 * picker that hid them would not offer the default. The empty value is the default agent
 * rather than "no agent" — a comment always runs on something.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Input from '@/components/obsidian/Input.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import type { AgentDefinition } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'

const STUBS = { Search: true, Dropdown: true, Input: true, Checkbox: true }

const agents = [
  { id: 'a1', name: 'Writer', description: '', utility: false },
  { id: 'u1', name: 'Comment', description: '', utility: true },
] as unknown as AgentDefinition[]

const open = () => mount(GeneralSettings, { global: { stubs: STUBS } })

/** The row carrying a given label, so a test names what a person reads. */
const rowFor = (wrapper: ReturnType<typeof open>, name: string) => {
  const row = wrapper.findAllComponents(Setting).find((s) => s.props('name') === name)
  if (!row) throw new Error(`No settings row named "${name}"`)
  return row
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    agents,
  } as AiSettings
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('the comment agent', () => {
  it('offers every agent, utility ones included, and the default', () => {
    const options = rowFor(open(), 'Comment agent').findComponent(Dropdown).props('options') as {
      value: string
      display: string
    }[]

    expect(options).toEqual([
      { value: '', display: 'Default agent' },
      { value: 'a1', display: 'Writer' },
      { value: 'u1', display: 'Comment' },
    ])
  })

  it('starts on the default agent when nothing was chosen', () => {
    expect(rowFor(open(), 'Comment agent').findComponent(Dropdown).props('modelValue')).toBe('')
  })

  it('remembers the agent that was picked', async () => {
    const wrapper = open()

    await rowFor(wrapper, 'Comment agent')
      .findComponent(Dropdown)
      .vm.$emit('update:model-value', 'u1')

    expect(AbeleConfig.getInstance().ai.commentAgentId).toBe('u1')
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
  })
})

describe('the comment folder', () => {
  it('says what it is for', () => {
    expect(rowFor(open(), 'Comment folder').props('desc')).toBe('Where comment chats are stored')
  })

  it('starts on the folder comments are stored in by default', () => {
    expect(rowFor(open(), 'Comment folder').findComponent(Input).props('modelValue')).toBe(
      'AI/Comments'
    )
  })

  it('remembers the folder that was typed', async () => {
    const wrapper = open()

    await rowFor(wrapper, 'Comment folder')
      .findComponent(Input)
      .vm.$emit('update:model-value', 'Notes/Comments')

    expect(AbeleConfig.getInstance().ai.commentFolder).toBe('Notes/Comments')
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
  })
})
