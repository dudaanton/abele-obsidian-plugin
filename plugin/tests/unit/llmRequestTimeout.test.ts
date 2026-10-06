import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig, StreamEvent } from '@/ai/client/types'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { useVault } from '../helpers/testEnv'

const model: ModelConfig = {
  id: 'sample-model',
  name: 'Sample',
  baseUrl: 'https://sample.invalid/v1',
  apiKey: '',
  contextWindow: 1000,
  maxTokens: 100,
  supportsReasoning: false,
}
const frame = new TextEncoder().encode(
  'data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n'
)
const collect = async (chosen: ModelConfig) => {
  const events: StreamEvent[] = []
  for await (const event of new OpenAIClient().stream(chosen, '', [], [])) events.push(event)
  return events
}

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.destroy()
  config.applySettings(undefined)
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    requestTimeoutSeconds: 120,
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample',
        baseUrl: model.baseUrl,
        apiKeyId: '',
        models: [model],
      },
    ],
    activeProviderId: 'sample-provider',
    activeModelId: model.id,
    auxiliaryModelId: `sample-provider::${model.id}`,
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('model request timeout settings', () => {
  it('reaches primary, fallback, background and legacy model configs', () => {
    const agent = createAgent({
      providerId: 'sample-provider',
      modelId: model.id,
      fallbackProviderId: 'sample-provider',
      fallbackModelId: model.id,
      auxiliaryProviderId: 'sample-provider',
      auxiliaryModelId: model.id,
    })
    const registry = AgentRegistry.getInstance()
    const service = ChatService.getInstance()
    for (const chosen of [
      registry.resolveModel(agent),
      registry.resolveModel(agent, { fallback: true }),
      registry.resolveModel(agent, { background: true }),
      service.getActiveModelConfig(),
      service.getAuxiliaryModelConfig(),
      service.getModelConfigFor('sample-provider', model.id),
    ])
      expect(chosen?.requestTimeoutSeconds).toBe(120)
  })

  it('travels in AI general settings', () => {
    const source = AbeleConfig.getInstance().exportSettings()
    const entry = collectEntries(source).find((item) => item.section === 'ai-general')!
    const received = applyEntries([entry], {
      ...source,
      ai: { ...source.ai, requestTimeoutSeconds: 60 },
    })
    expect(received.ai.requestTimeoutSeconds).toBe(120)
  })

  it.each(['headers', 'stream', 'error body'] as const)(
    'waits past 60 seconds for slow %s',
    async (phase) => {
      vi.useFakeTimers()
      const body = () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            window.setTimeout(
              () => {
                controller.enqueue(
                  phase === 'error body' ? new TextEncoder().encode('busy') : frame
                )
                controller.close()
              },
              phase === 'headers' ? 0 : 70_000
            )
          },
        })
      vi.spyOn(window, 'fetch').mockImplementation(async () => {
        if (phase === 'headers') await new Promise((resolve) => window.setTimeout(resolve, 70_000))
        return new Response(body(), { status: phase === 'error body' ? 503 : 200 })
      })
      const chosen = ChatService.getInstance().getActiveModelConfig()
      let settled = false
      const work = collect(chosen).then((events) => {
        settled = true
        return events
      })
      await vi.advanceTimersByTimeAsync(60_001)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(10_000)
      const events = await work
      if (phase === 'error body') {
        expect(events.at(-1)).toMatchObject({ type: 'error', error: 'HTTP 503: busy' })
      } else {
        expect(events.at(-1)).toMatchObject({
          type: 'done',
          message: { stopReason: 'stop', content: [{ type: 'text', text: 'Ready' }] },
        })
      }
    }
  )

  it.each([undefined, 0, -1, 0.5, 3601, Infinity, NaN])(
    'keeps a 60-second connection deadline for absent or invalid value %s',
    async (requestTimeoutSeconds) => {
      vi.useFakeTimers()
      let signal: AbortSignal | undefined
      vi.spyOn(window, 'fetch').mockImplementation((_url, options) => {
        signal = options?.signal as AbortSignal
        return new Promise(() => {})
      })
      const work = collect({ ...model, requestTimeoutSeconds })
      await vi.advanceTimersByTimeAsync(60_001)
      expect((await work).at(-1)).toMatchObject({
        type: 'error',
        error: 'Request timed out after 60s',
      })
      expect(signal?.aborted).toBe(true)
    }
  )

  it('ends and cancels a silent stream at the configured deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel })))
    const work = collect({ ...model, requestTimeoutSeconds: 90 })
    await vi.advanceTimersByTimeAsync(60_001)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await work).at(-1)).toMatchObject({
      type: 'error',
      error: 'Request timed out after 90s',
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('treats the timeout as idle time, not total response time', async () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            window.setTimeout(
              () => controller.enqueue(new TextEncoder().encode(': waiting\n\n')),
              50_000
            )
            window.setTimeout(() => {
              controller.enqueue(frame)
              controller.close()
            }, 100_000)
          },
        })
      )
    )
    const work = collect(model)
    await vi.advanceTimersByTimeAsync(100_001)
    expect((await work).at(-1)).toMatchObject({ type: 'done', message: { stopReason: 'stop' } })
  })
})
