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
let fetch: ReturnType<typeof vi.spyOn<typeof window, 'fetch'>>

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
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
  expect(key).toMatch(/^abele-[a-f0-9]{64}$/)
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
