/**
 * The chat's global system prompt now comes from the Default agent's prompt blocks rather
 * than `ai.prompts.system`. Per-chat overrides are untouched in this phase and must keep
 * winning, because chats saved before agents existed still carry them.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { ChatSession } from '@/ai/ChatSession'

/** The slice of ChatSession that getSystemPrompt actually reads. */
function fakeSession(
  overrides: {
    customSystemPrompt?: string
    customSystemPromptNotePath?: string
    agentId?: string
  } = {}
): ChatSession {
  return {
    customSystemPrompt: ref(overrides.customSystemPrompt ?? ''),
    customSystemPromptNotePath: ref(overrides.customSystemPromptNotePath ?? ''),
    // The prompt comes from the session's own agent, so a fake without one is not a chat.
    agent: computed(() =>
      overrides.agentId
        ? AgentRegistry.getInstance().get(overrides.agentId)
        : AgentRegistry.getInstance().defaultAgent()
    ),
  } as unknown as ChatSession
}

beforeEach(() => {
  useVault([{ path: 'Prompts/Chat.md', content: 'Prompt from a note.' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

describe('ChatService.getSystemPrompt', () => {
  it('returns the Default agent prompt blocks, concatenated', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Default',
      prompts: [
        { type: 'text', value: 'Block one.' },
        { type: 'text', value: 'Block two.' },
      ],
    })
    registry.setDefault(agent.id)

    const prompt = await ChatService.getInstance().getSystemPrompt(fakeSession())

    expect(prompt).toBe('Block one.\n\nBlock two.')
  })

  it('reflects an edit to the agent immediately, with nothing reloaded', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Default',
      prompts: [{ type: 'text', value: 'Before.' }],
    })
    registry.setDefault(agent.id)
    const service = ChatService.getInstance()

    expect(await service.getSystemPrompt(fakeSession())).toBe('Before.')

    registry.update(agent.id, { prompts: [{ type: 'text', value: 'After.' }] })

    expect(await service.getSystemPrompt(fakeSession())).toBe('After.')
  })

  it('still lets a per-chat inline override win', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Default',
      prompts: [{ type: 'text', value: 'Agent.' }],
    })
    registry.setDefault(agent.id)

    const prompt = await ChatService.getInstance().getSystemPrompt(
      fakeSession({ customSystemPrompt: 'Chat override.' })
    )

    expect(prompt).toBe('Chat override.')
  })

  it('still lets a per-chat note override win', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Default',
      prompts: [{ type: 'text', value: 'Agent.' }],
    })
    registry.setDefault(agent.id)

    const prompt = await ChatService.getInstance().getSystemPrompt(
      fakeSession({ customSystemPromptNotePath: 'Prompts/Chat.md' })
    )

    expect(prompt).toBe('Prompt from a note.')
  })

  it('uses the prompt of the agent this chat is on, not the default one', async () => {
    const registry = AgentRegistry.getInstance()
    const fallback = registry.create({
      name: 'Default',
      prompts: [{ type: 'text', value: 'Default agent.' }],
    })
    registry.setDefault(fallback.id)
    const other = registry.create({
      name: 'Researcher',
      prompts: [{ type: 'text', value: 'Researcher agent.' }],
    })

    const prompt = await ChatService.getInstance().getSystemPrompt(
      fakeSession({ agentId: other.id })
    )

    expect(prompt).toBe('Researcher agent.')
  })

  it('falls back to the built-in prompt when there is no agent at all', async () => {
    const prompt = await ChatService.getInstance().getSystemPrompt(fakeSession())

    expect(prompt).toBe(DEFAULT_AI_SETTINGS.prompts.system)
  })
})
