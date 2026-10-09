import { createServer, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ModelConfig, StreamEvent } from '@/ai/client/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().destroy()
  AbeleConfig.getInstance().applySettings(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  ChatService.getInstance().destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().destroy()
})

const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
const reasoning = frame({ reasoning_content: 'Considering the sample request.' })
const answer = frame({ content: 'Sample answer.' }, 'stop') + 'data: [DONE]\n\n'

async function proxy(serve: (response: ServerResponse) => void) {
  let path = '',
    body = ''
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    path = request.url ?? ''
    request.on('data', (chunk) => {
      body += String(chunk)
    })
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
      response.write(reasoning)
      serve(response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/custom/v1`
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    requestTimeoutSeconds: 300,
    autoRetry: { attempts: 0, firstDelayMs: 1000 },
    providers: [
      {
        id: 'sample-proxy',
        name: 'Sample proxy',
        baseUrl,
        apiKeyId: '',
        models: [
          {
            id: 'sample-reasoner',
            name: 'Sample reasoner',
            contextWindow: 1000,
            maxTokens: 100,
            supportsReasoning: true,
          },
        ],
      },
    ],
    activeProviderId: 'sample-proxy',
    activeModelId: 'sample-reasoner',
  }
  return {
    model: ChatService.getInstance().getActiveModelConfig(),
    request: () => ({ path, body: JSON.parse(body) }),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function collect(model: ModelConfig, signal?: AbortSignal) {
  let started!: () => void
  const thinking = new Promise<void>((resolve) => {
    started = resolve
  })
  const work = (async () => {
    const events: StreamEvent[] = []
    for await (const event of new OpenAIClient().stream(model, '', [], [], { signal })) {
      events.push(event)
      if (event.type === 'thinking_delta') started()
    }
    return events
  })()
  return { thinking, work }
}

describe('OpenAI-compatible proxy reasoning delays', () => {
  it.each(['silent', 'comments', 'empty deltas'] as const)(
    'waits 90 seconds through %s with a global 300-second timeout',
    async (mode) => {
      vi.useFakeTimers()
      const server = await proxy((response) => {
        const keepalive =
          mode === 'silent'
            ? undefined
            : window.setInterval(() => {
                response.write(mode === 'comments' ? ': keep-alive\n\n' : frame({}))
              }, 30_000)
        const finish = window.setTimeout(() => response.end(answer), 90_000)
        response.on('close', () => {
          window.clearInterval(keepalive)
          window.clearTimeout(finish)
        })
      })
      try {
        expect(server.model.requestTimeoutSeconds).toBe(300)
        const turn = collect(server.model)
        await turn.thinking
        let ended = false
        void turn.work.then(() => {
          ended = true
        })
        await vi.advanceTimersByTimeAsync(60_001)
        expect(ended).toBe(false)
        await vi.advanceTimersByTimeAsync(30_000)
        const events = await turn.work
        expect(events.at(-1)).toMatchObject({
          type: 'done',
          message: {
            stopReason: 'stop',
            content: expect.arrayContaining([{ type: 'text', text: 'Sample answer.' }]),
          },
        })
        expect(server.request()).toMatchObject({
          path: '/custom/v1/chat/completions',
          body: { stream: true },
        })
      } finally {
        await server.close()
      }
    }
  )

  it.each(['closed stream', 'SSE timeout', 'idle timeout', 'reasoning limit'] as const)(
    'shows a %s as a chat error, not a successful thinking-only answer',
    async (mode) => {
      vi.useFakeTimers()
      let ready!: () => void
      const thinking = new Promise<void>((resolve) => {
        ready = resolve
      })
      const server = await proxy((response) => {
        ready()
        if (mode !== 'idle timeout') {
          const finish = window.setTimeout(
            () =>
              response.end(
                mode === 'SSE timeout'
                  ? 'data: {"error":{"message":"Upstream request timed out","type":"timeout"}}\n\ndata: [DONE]\n\n'
                  : mode === 'reasoning limit'
                    ? frame({}, 'length') + 'data: [DONE]\n\n'
                    : ''
              ),
            60_000
          )
          response.on('close', () => window.clearTimeout(finish))
        }
      })
      const registry = AgentRegistry.getInstance()
      const agent = registry.create({
        name: 'Sample agent',
        providerId: 'sample-proxy',
        modelId: server.model.id,
      })
      registry.setDefault(agent.id)
      const service = ChatService.getInstance()
      const session = new ChatSession(service)
      vi.spyOn(session, 'save').mockResolvedValue(undefined)
      vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('')
      const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
        .summarizer
      for (const name of [
        'generateTitle',
        'generateSummary',
        'generateRecap',
        'autoCompactIfNeeded',
      ])
        vi.spyOn(summarizer, name).mockResolvedValue(undefined)
      try {
        const work = session.sendMessage('Answer the sample request.')
        await thinking
        // The server has sent a frame, but the client's idle deadline starts only after
        // consuming it. Do not jump the fake clock ahead of that read.
        await vi.waitFor(() => expect(session.streamingThinking.value).toContain('Considering the sample request.'))
        await vi.advanceTimersByTimeAsync(mode === 'idle timeout' ? 300_001 : 60_001)
        await work
        expect(session.error.value).toMatch(
          mode === 'SSE timeout'
            ? /Upstream request timed out/
            : mode === 'idle timeout'
              ? /Request timed out after 300s/
              : mode === 'reasoning limit'
                ? /output token limit.*answer/i
                : /ended before.*complet/i
        )
        expect(session.allMessages.value.map((message) => message.role)).toEqual(['user'])
        expect(session.isStreaming.value).toBe(false)
      } finally {
        session.destroy()
        await server.close()
      }
    }
  )

  it('accepts a finish reason when a proxy omits the DONE sentinel', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(frame({ content: 'Sample answer.' }, 'stop'))
    )
    const turn = collect({
      id: 'sample',
      name: 'Sample',
      baseUrl: 'https://proxy.sample.invalid/v1',
      apiKey: '',
      contextWindow: 1000,
      maxTokens: 100,
      supportsReasoning: false,
      requestTimeoutSeconds: 300,
    })
    expect((await turn.work).at(-1)).toMatchObject({
      type: 'done',
      message: { stopReason: 'stop', content: [{ type: 'text', text: 'Sample answer.' }] },
    })
  })

  it('does not mistake partial text for a completed answer when the proxy closes', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(frame({ content: 'Partial sample' })))
    const turn = collect({
      id: 'sample',
      name: 'Sample',
      baseUrl: 'https://proxy.sample.invalid/v1',
      apiKey: '',
      contextWindow: 1000,
      maxTokens: 100,
      supportsReasoning: false,
      requestTimeoutSeconds: 300,
    })
    expect((await turn.work).at(-1)).toMatchObject({
      type: 'error',
      message: { stopReason: 'error', content: [{ type: 'text', text: 'Partial sample' }] },
    })
  })

  it('reports a transport AbortError while reading the reasoning stream', async () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(reasoning))
            window.setTimeout(
              () => controller.error(new DOMException('Transport timed out', 'AbortError')),
              60_000
            )
          },
        })
      )
    )
    const turn = collect({
      id: 'sample',
      name: 'Sample',
      baseUrl: 'https://proxy.sample.invalid/v1',
      apiKey: '',
      contextWindow: 1000,
      maxTokens: 100,
      supportsReasoning: true,
      requestTimeoutSeconds: 300,
    })
    await turn.thinking
    await vi.advanceTimersByTimeAsync(60_001)
    expect((await turn.work).at(-1)).toMatchObject({
      type: 'error',
      error: 'Transport timed out',
      message: { stopReason: 'error' },
    })
  })

  it('reports a transport AbortError unless the caller actually requested Stop', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(
      new DOMException('Connection timed out', 'AbortError')
    )
    const model = {
      id: 'sample',
      name: 'Sample',
      baseUrl: 'https://proxy.sample.invalid/v1',
      apiKey: '',
      contextWindow: 1000,
      maxTokens: 100,
      supportsReasoning: true,
      requestTimeoutSeconds: 300,
    }
    expect((await collect(model).work).at(-1)).toMatchObject({
      type: 'error',
      error: 'Connection timed out',
      message: { stopReason: 'error' },
    })
    const stop = new AbortController()
    stop.abort()
    expect((await collect(model, stop.signal).work).at(-1)).toMatchObject({
      type: 'done',
      message: { stopReason: 'aborted' },
    })
  })
})
