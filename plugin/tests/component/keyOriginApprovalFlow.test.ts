import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import { initializeDestinations } from '@/secrets/destinations'
import { needsSecretApproval } from '@/ai/tools/secretUtils'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let planned: ToolCallContent[] = []
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[]) {
      const calls = messages.some((m) => m.role === 'toolResult') ? [] : planned
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: calls.length ? calls : [{ type: 'text', text: 'Sample answer' }],
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: calls.length ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        },
      }
    }
  },
}))
const provider: AiProvider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://model.example/v1',
  apiKeyId: '',
  models: [
    {
      id: 'sample-model',
      name: 'Sample model',
      contextWindow: 32000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}
const request = {
  url: 'https://api.sample.example/data',
  headers: { Authorization: '${abele_key:sample}' },
}
const call = (id: string, args = request): ToolCallContent => ({
  type: 'toolCall',
  id,
  name: 'fetch',
  arguments: structuredClone(args),
})
let session: ChatSession
const active = shallowRef<ChatSession | null>(null)
let view: ReturnType<typeof mount>
let executed: string[]
const makeSession = () => {
  const s = new ChatSession(ChatService.getInstance())
  vi.spyOn(s, 'save').mockResolvedValue()
  s.toolModes.value = { fetch: 'auto' }
  vi.spyOn(s as unknown as { getTools(): AgentTool[] }, 'getTools').mockReturnValue([
    {
      name: 'fetch',
      label: 'Fetch',
      description: 'Synthetic request; no transport or key values',
      parameters: {},
      execute: async (id) => {
        executed.push(`${s.id}:${id}`)
        await nextTick()
        return { content: [{ type: 'text', text: 'done' }] }
      },
    },
  ])
  const summarizer = (
    s as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue()
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue()
  return s
}
const button = (text: string) => view.findAll('button').find((b) => b.text() === text)!
const start = async (...calls: ToolCallContent[]) => {
  planned = calls
  await session.sendMessage('Use the sample request')
  await flushPromises()
  expect(view.findComponent(AiToolApproval).exists()).toBe(true)
}

destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(config, 'saveSettings').mockResolvedValue()
  initializeDestinations(config)
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample worker',
    providerId: provider.id,
    modelId: 'sample-model',
  })
  AgentRegistry.getInstance().setDefault(agent.id)
  executed = []
  session = makeSession()
  active.value = session
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('')
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active)
  view = mount(AiChat, { attachTo: document.body })
})
afterEach(() => {
  view.unmount()
  active.value = null
  vi.restoreAllMocks()
})

describe('trusting the current saved-key origin', () => {
  it('settles the first call exactly once without a second Send once card', async () => {
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.pendingToolCalls.value).toEqual([])
    expect(view.findComponent(AiToolApproval).exists()).toBe(false)
    expect(session.toolModes.value).toEqual({ fetch: 'auto' })
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
    expect(needsSecretApproval('fetch', request)).toBe(false)
    expect(needsSecretApproval('fetch', { ...request, url: 'https://other.example/data' })).toBe(
      true
    )
    expect(
      needsSecretApproval('fetch', { ...request, headers: { Authorization: '${abele_key:other}' } })
    ).toBe(true)
  })

  it('does not use destination trust to approve an independent tool permission', async () => {
    session.toolModes.value = { fetch: 'ask' }
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(view.findComponent(AiToolApproval).exists()).toBe(true)
    await button('Send once').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.toolModes.value).toEqual({ fetch: 'ask' })
  })

  it('waits for persistence and never approves a different chat after a tab switch', async () => {
    const saving = deferred()
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await nextTick()
    expect(executed).toEqual([])
    const other = makeSession()
    planned = [call('other', { ...request, url: 'https://other.example/data' })]
    await other.sendMessage('Use a different sample request')
    active.value = other
    await nextTick()
    saving.resolve()
    await flushPromises()
    expect(executed).toEqual([])
    expect(session.pendingToolCalls.value[0].id).toBe('first')
    expect(other.pendingToolCalls.value[0].id).toBe('other')
  })

  it.each(['args', 'key', 'reject'])(
    'does not settle a stale %s while trust is saving',
    async (change) => {
      const saving = deferred()
      vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
      await start(call('first'))
      await button('Allow this address for these keys').trigger('click')
      if (change === 'args')
        session.pendingToolCalls.value[0].arguments.url = 'https://other.example/data'
      if (change === 'key') AbeleConfig.getInstance().ai.secrets[0].keyId = 'replacement-key'
      if (change === 'reject') await session.rejectToolCall()
      saving.resolve()
      await flushPromises()
      expect(executed).toEqual([])
    }
  )

  it('ignores duplicate trust clicks while saving and settles only after success', async () => {
    const saving = deferred()
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
    await start(call('first'))
    const trust = button('Allow this address for these keys')
    await trust.trigger('click')
    await trust.trigger('click')
    expect(executed).toEqual([])
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalledTimes(1)
    saving.resolve()
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
  })

  it('keeps the call unexecuted and displays failed trust persistence', async () => {
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockRejectedValue(
      new Error('Synthetic save failure')
    )
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(view.text()).toContain('Synthetic save failure')
    expect(needsSecretApproval('fetch', request)).toBe(true)
  })

  it('keeps Send once local to its call, leaving another key request and chat pending', async () => {
    const other = makeSession()
    planned = [call('other')]
    await other.sendMessage('Use another sample request')
    await start(call('first'), call('second'))
    await button('Approve').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.pendingToolCalls.value[0].id).toBe('second')
    expect(other.pendingToolCalls.value[0].id).toBe('other')
    expect(needsSecretApproval('fetch', request)).toBe(true)
    expect(AbeleConfig.getInstance().ai.secrets[0].allowedOrigins).toBeUndefined()
  })
})
