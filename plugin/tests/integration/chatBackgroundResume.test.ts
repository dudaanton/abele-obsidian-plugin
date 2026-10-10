import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { appSuspension, bindAppSuspension } from '@/ai/appSuspension'
import type { Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

let session: ChatSession
let unbind: () => void
let hidden: boolean
let requests: Message[][]
let finish!: () => void
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}
const visibility = (value: boolean) => {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  useVault([])
  hidden = false
  requests = []
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible'
  )
  unbind = bindAppSuspension(appSuspension, document, window)
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    autoRetry: { attempts: 0, firstDelayMs: 1000 },
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample',
        baseUrl: 'https://model.example/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample',
            name: 'Sample',
            contextWindow: 10000,
            maxTokens: 100,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample',
    providerId: 'sample-provider',
    modelId: 'sample',
  })
  registry.setDefault(agent.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
    vi.spyOn(summarizer, key).mockResolvedValue(undefined)
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _prompt, messages, _tools, options) {
      requests.push(structuredClone(messages))
      if (requests.length === 1) {
        yield { type: 'text_delta', delta: 'unfinished response' }
        visibility(true)
        yield { type: 'error', error: 'Network connection lost' }
      } else {
        await new Promise<void>((resolve) => {
          finish = resolve
          options?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        if (!options?.signal?.aborted)
          yield {
            type: 'done',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Complete response' }],
              model: 'sample',
              stopReason: 'stop',
              timestamp: 1,
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
            },
          }
      }
    }
  )
})
afterEach(() => {
  session.destroy()
  unbind()
  vi.restoreAllMocks()
})

it('shows a quiet reconnecting state and commits one answer without duplicate partial text', async () => {
  const done = session.sendMessage('Sample question')
  await flush()
  expect(session.reconnecting.value).toBe('waiting')
  expect(session.isStreaming.value).toBe(true)
  expect(session.error.value).toBeNull()
  visibility(false)
  await flush()
  expect(session.reconnecting.value).toBe('connecting')
  expect(session.streamingContent.value).toBe('')
  expect(requests[1]).toEqual(requests[0])
  finish()
  await done
  expect(session.messages.value.map((m) => m.content)).toEqual([
    'Sample question',
    'Complete response',
  ])
  expect(session.reconnecting.value).toBeNull()
})

it('leaves a stopped waiting turn stopped when the app returns', async () => {
  const done = session.sendMessage('Sample question')
  await flush()
  session.abort()
  visibility(false)
  await done
  expect(requests).toHaveLength(1)
  expect(session.messages.value.map((m) => m.role)).toEqual(['user'])
  expect(session.reconnecting.value).toBeNull()
})

it('does not resume a tab destroyed while waiting', async () => {
  const done = session.sendMessage('Sample question')
  await flush()
  session.destroy()
  visibility(false)
  await done
  expect(requests).toHaveLength(1)
})
