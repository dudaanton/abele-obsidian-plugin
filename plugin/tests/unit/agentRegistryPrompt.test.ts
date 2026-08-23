import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import dayjs from 'dayjs'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([
    {
      path: 'Prompts/Base.md',
      frontmatter: { type: 'prompt' },
      content: 'You work inside a vault.',
    },
    { path: 'Prompts/Empty.md', content: '' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentRegistry.buildSystemPrompt', () => {
  it('concatenates blocks in order with a blank line between them', async () => {
    const agent = createAgent({
      prompts: [
        { type: 'text', value: 'First.' },
        { type: 'text', value: 'Second.' },
      ],
    })

    expect(await AgentRegistry.getInstance().buildSystemPrompt(agent)).toBe('First.\n\nSecond.')
  })

  it('reads a note block as the note body, without its frontmatter', async () => {
    const agent = createAgent({
      prompts: [
        { type: 'note', value: 'Prompts/Base.md' },
        { type: 'text', value: 'Be concise.' },
      ],
    })

    expect(await AgentRegistry.getInstance().buildSystemPrompt(agent)).toBe(
      'You work inside a vault.\n\nBe concise.'
    )
  })

  it('substitutes {{date}} with today in every block', async () => {
    const agent = createAgent({ prompts: [{ type: 'text', value: 'Today is {{date}}.' }] })

    expect(await AgentRegistry.getInstance().buildSystemPrompt(agent)).toBe(
      `Today is ${dayjs().format('YYYY-MM-DD')}.`
    )
  })

  it('skips a missing note and warns, rather than failing the whole request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const agent = createAgent({
      prompts: [
        { type: 'note', value: 'Prompts/Gone.md' },
        { type: 'text', value: 'Still here.' },
      ],
    })

    expect(await AgentRegistry.getInstance().buildSystemPrompt(agent)).toBe('Still here.')
    expect(warn).toHaveBeenCalled()
  })

  it('skips blocks that are empty or whitespace, so no stray blank lines reach the model', async () => {
    const agent = createAgent({
      prompts: [
        { type: 'text', value: 'Kept.' },
        { type: 'text', value: '   ' },
        { type: 'note', value: 'Prompts/Empty.md' },
        { type: 'text', value: 'Also kept.' },
      ],
    })

    expect(await AgentRegistry.getInstance().buildSystemPrompt(agent)).toBe('Kept.\n\nAlso kept.')
  })

  it('returns an empty string for an agent with no prompts', async () => {
    expect(await AgentRegistry.getInstance().buildSystemPrompt(createAgent())).toBe('')
  })
})
