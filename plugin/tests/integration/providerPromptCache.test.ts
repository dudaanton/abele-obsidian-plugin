import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatSummarizer } from '@/ai/ChatSummarizer'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const model = {
  id: 'sample',
  name: 'Sample',
  contextWindow: 100000,
  maxTokens: 100,
  supportsReasoning: false,
}
const provider = {
  id: 'sample',
  name: 'Sample',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyId: '',
  models: [model],
}
let session: ChatSession
let service: ChatService
let app: ReturnType<typeof useVault>
let fetch: ReturnType<typeof vi.spyOn<typeof window, 'fetch'>>

beforeEach(() => {
  app = useVault([{ path: 'Notes/Sample.md', content: 'Original passage.' }])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [{ ...provider, models: [{ ...model }] }],
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  const registry = AgentRegistry.getInstance()
  registry.setDefault(
    registry.create({
      name: 'Sample',
      providerId: provider.id,
      modelId: model.id,
      prompts: [{ type: 'text', value: 'Stable instructions.' }],
    }).id
  )
  service = ChatService.getInstance()
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  for (const key of [
    'generateTitle',
    'generateSummary',
    'generateRecap',
    'autoCompactIfNeeded',
  ] as const)
    vi.spyOn(ChatSummarizer.prototype, key).mockResolvedValue(undefined)
  session = new ChatSession(service)
  vi.spyOn(session as unknown as { getTools(): [] }, 'getTools').mockReturnValue([])
  fetch = vi.spyOn(window, 'fetch').mockImplementation(
    async () =>
      new Response(
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: 'Sample answer.' }, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 },
            },
          }) +
          '\n\ndata: [DONE]\n\n'
      )
  )
})
afterEach(async () => {
  await session.flush()
  session.destroy()
  service.destroy()
  ChatStorage.destroy()
  AgentRegistry.destroy()
  vi.restoreAllMocks()
})

it.each(['chat-completions', 'responses'] as const)(
  'compacts with a byte-identical ordinary request prefix and retains the latest instruction (%s)',
  async (apiMode) => {
    AbeleConfig.getInstance().ai.providers[0].apiMode = apiMode
    if (apiMode === 'responses')
      fetch.mockImplementation(
        async () =>
          new Response(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Sample summary."}\n\n' +
              'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":2}}}\n\n'
          )
      )
    await session.sendMessage('The previous task is finished.')
    await session.sendMessage('The old result is released.')
    await session.sendMessage('Fix the current task. Do not run live tests.')
    const previous = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
    const before = structuredClone(session.messagesForModel())
    await session.compact()
    const compact = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
    const field = apiMode === 'responses' ? 'input' : 'messages'
    expect(JSON.stringify(compact[field].slice(0, previous[field].length))).toBe(
      JSON.stringify(previous[field])
    )
    expect(compact.model).toBe(previous.model)
    expect(compact.tools).toEqual(previous.tools)
    expect(compact.instructions).toBe(previous.instructions)
    expect(compact.prompt_cache_key).toBe(previous.prompt_cache_key)
    expect(compact[field].at(-1).content).toContain('Do not call tools')
    const after = session.messagesForModel()
    const lastOwner = before.findLastIndex((message) => message.role === 'user')
    expect(after[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('[Conversation compacted]'),
    })
    expect(after.slice(1).map(({ chatMessageId: _id, ...message }) => message)).toEqual(
      before
        .slice(Math.min(lastOwner, before.length - 2))
        .map(({ chatMessageId: _id, ...message }) => message)
    )
  }
)

it('keeps cache usage in visible and saved messages and debug diagnostics', async () => {
  const debug = vi.spyOn(console, 'debug')
  await session.sendMessage('Sample question')
  expect(session.messages.value.at(-1)?.usage).toMatchObject({
    input: 40,
    output: 10,
    cacheRead: 40,
    cacheWrite: 20,
    total: 110,
  })
  await session.flush()
  await session.load(session.currentChatFile.value!)
  expect(session.messages.value.at(-1)?.usage).toMatchObject({ cacheRead: 40, cacheWrite: 20 })
  expect(debug).toHaveBeenCalledWith(
    '[Abele model] usage',
    expect.objectContaining({ cacheRead: 40, cacheWrite: 20 })
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('uses one opaque cache key across turns and reloads, and a different key for another chat', async () => {
  const body = () => JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
  await session.sendMessage('First')
  const key = body().prompt_cache_key
  expect(key).toMatch(/^[a-f0-9]{64}$/)
  await session.flush()
  await session.load(session.currentChatFile.value!)
  await session.sendMessage('Second')
  expect(body().prompt_cache_key).toBe(key)
  const other = new ChatSession(service)
  try {
    await other.sendMessage('Another chat')
    expect(body().prompt_cache_key).not.toBe(key)
  } finally {
    other.destroy()
  }
})

it.each([true, false])(
  'retains the provider capability through every model resolver (%s)',
  (promptCacheKey) => {
    AbeleConfig.getInstance().ai.providers[0].promptCacheKey = promptCacheKey
    AbeleConfig.getInstance().ai.activeProviderId = provider.id
    AbeleConfig.getInstance().ai.activeModelId = model.id
    AbeleConfig.getInstance().ai.auxiliaryModelId = `${provider.id}::${model.id}`
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Sample auxiliary',
      providerId: provider.id,
      modelId: model.id,
      fallbackProviderId: provider.id,
      fallbackModelId: model.id,
      auxiliaryProviderId: provider.id,
      auxiliaryModelId: model.id,
    })
    for (const config of [
      service.getActiveModelConfig(),
      service.getModelConfigFor(provider.id, model.id),
      service.getAuxiliaryModelConfig(),
      registry.resolveModel(agent),
      registry.resolveModel(agent, { fallback: true }),
      registry.resolveModel(agent, { background: true }),
    ])
      expect(config?.promptCacheKey).toBe(promptCacheKey)
  }
)

it('supersedes forgotten memory without rewriting the previous snapshot', async () => {
  const registry = AgentRegistry.getInstance()
  const agent = registry.defaultAgent()!
  registry.update(agent.id, {
    memory: [{ id: 'sample-memory', text: 'A remembered preference.', created: '2026-01-01' }],
  })
  await session.sendMessage('First')
  const first = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body)).messages
  registry.update(agent.id, { memory: [] })
  await session.sendMessage('Second')
  const second = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body)).messages
  expect(second.slice(0, first.length)).toEqual(first)
  expect(second.at(-1).content).toContain('No current agent memory or anchored context.')
  const count = session.messagesForModel().length
  await session.sendMessage('Third')
  expect(session.messagesForModel()).toHaveLength(count + 2)
})

it.each(['chat-completions', 'responses'] as const)(
  'preserves the entire sent prefix when memory and anchored context change (%s)',
  async (apiMode) => {
    AbeleConfig.getInstance().ai.providers[0].apiMode = apiMode
    if (apiMode === 'responses')
      fetch.mockImplementation(
        async () =>
          new Response(
            'data: ' +
              JSON.stringify({ type: 'response.output_text.delta', delta: 'Sample answer.' }) +
              '\n\n' +
              'data: ' +
              JSON.stringify({
                type: 'response.completed',
                response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 2 } },
              }) +
              '\n\n'
          )
      )
    const registry = AgentRegistry.getInstance()
    const agent = registry.defaultAgent()!
    registry.update(agent.id, {
      memory: [{ id: 'sample-memory', text: 'Original memory.', created: '2026-01-01' }],
    })
    session.destroy()
    session = new ChatSession(service, undefined, {
      kind: 'comment',
      anchor: { note: 'Notes/Sample.md', quote: 'passage' },
    })
    vi.spyOn(session as unknown as { getTools(): [] }, 'getTools').mockReturnValue([])
    const body = () => JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
    await session.sendMessage('First')
    const first = body()
    const firstMessages = first.messages ?? first.input
    const system = first.instructions ?? firstMessages[0].content
    expect(system).toBe('Stable instructions.')
    expect(JSON.stringify(firstMessages)).toContain('Original memory.')
    expect(JSON.stringify(firstMessages)).toContain('Original passage.')
    await session.flush()
    await session.load(session.currentChatFile.value!)
    registry.update(agent.id, {
      memory: [{ id: 'sample-memory', text: 'Updated memory.', created: '2026-01-01' }],
    })
    await app.vault.modify(app.vault.getAbstractFileByPath('Notes/Sample.md')!, 'Updated passage.')
    await session.sendMessage('Second')
    const second = body()
    const secondMessages = second.messages ?? second.input
    expect(second.instructions ?? secondMessages[0].content).toBe(system)
    expect(JSON.stringify(secondMessages.slice(0, firstMessages.length))).toBe(
      JSON.stringify(firstMessages)
    )
    expect(JSON.stringify(secondMessages.slice(firstMessages.length))).toContain('Updated memory.')
    expect(JSON.stringify(secondMessages.slice(firstMessages.length))).toContain('Updated passage.')
    expect(session.messages.value.some((m) => m.content.includes('Original memory.'))).toBe(false)
    // An unchanged snapshot must not grow on every request.
    const snapshots = session.messagesForModel().filter((m) => m.role === 'system').length
    await session.sendMessage('Third')
    expect(session.messagesForModel().filter((m) => m.role === 'system')).toHaveLength(snapshots)
  }
)

it.each(['chat-completions', 'responses'] as const)(
  'gates cache keys per provider for %s',
  async (apiMode) => {
    for (const [baseUrl, promptCacheKey, accepted] of [
      ['https://api.openai.com/v1', undefined, true],
      ['https://api.openai.com/v1', false, false],
      ['https://gateway.example.invalid/v1', undefined, false],
      ['https://gateway.example.invalid/v1', true, true],
      ['https://api.openai.com.example.invalid/v1', undefined, false],
    ] as const) {
      const config: ModelConfig = { ...model, apiKey: '', baseUrl, apiMode, promptCacheKey }
      for await (const event of new OpenAIClient().stream(config, 'Stable', [], [], {
        promptCacheKey: 'sample-key',
      }))
        void event
      const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
      expect(body.prompt_cache_key).toBe(accepted ? 'sample-key' : undefined)
    }
  }
)
