import { afterEach, expect, it, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig } from '@/ai/client'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.restoreAllMocks())

it('does not start a tool after Stop during its approval hook', async () => {
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
    yield {
      type: 'done',
      message: {
        role: 'assistant',
        model: 'sample',
        timestamp: 1,
        stopReason: 'toolUse',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        content: [{ type: 'toolCall', id: 'sample-call', name: 'sample_request', arguments: {} }],
      },
    }
  })
  const entered = deferred()
  const release = deferred()
  const execute = vi.fn(async () => ({ content: [] }))
  const loop = new AgentLoop()
  const call = loop.run({
    model: { id: 'sample' } as ModelConfig,
    systemPrompt: '',
    messages: [],
    tools: [{ name: 'sample_request', description: '', parameters: {}, execute }],
    beforeToolCall: async () => {
      entered.resolve()
      await release.promise
    },
  })
  await entered.promise
  loop.abort()
  release.resolve()
  await call
  expect(execute).not.toHaveBeenCalled()
})
