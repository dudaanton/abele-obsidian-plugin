import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatSummarizer } from '@/ai/ChatSummarizer'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
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
  fetch = vi
    .spyOn(window, 'fetch')
    .mockImplementation(
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
