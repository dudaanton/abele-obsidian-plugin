import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { appSuspension, bindAppSuspension } from '@/ai/appSuspension'
import type { AgentEvent, AssistantMessage, Message, ModelConfig } from '@/ai/client'

const model = { id: 'sample', baseUrl: 'https://model.example/v1' } as ModelConfig
const answer = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  model: 'sample',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  stopReason: 'stop',
  timestamp: 1,
})
let unbind: () => void
let visibility: 'visible' | 'hidden'
let requests: Message[][]
const visible = () => {
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
}
const hidden = () => {
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  requests = []
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  unbind = bindAppSuspension(appSuspension, document, window)
})
afterEach(() => {
  unbind()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function droppingProvider(error = 'Network connection lost') {
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _prompt, messages) {
      requests.push(structuredClone(messages))
      if (requests.length === 1) {
        yield { type: 'text_delta', delta: 'unfinished' }
        hidden()
        yield { type: 'error', error }
      } else yield { type: 'done', message: answer('complete answer') }
    }
  )
}
function run(events: AgentEvent[] = [], tools: Parameters<AgentLoop['run']>[0]['tools'] = []) {
  const loop = new AgentLoop()
  loop.subscribe((event) => events.push(event))
  const done = loop.run({
    model,
    systemPrompt: '',
    tools,
    messages: [{ role: 'user', content: 'Sample question', timestamp: 1 }],
  })
  return { loop, done }
}

describe('an unfinished mobile request', () => {
  it('waits for return, then resumes exactly the failed request once, discarding partial text', async () => {
    droppingProvider()
    const events: AgentEvent[] = []
    const { done } = run(events)
    await flush()
    expect(requests).toHaveLength(1)
    expect(events).toContainEqual({ type: 'reconnecting', state: 'waiting' })
    visible()
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('resume'))
    const result = await done
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(result.messages.filter((m) => m.role === 'assistant')).toEqual([
      answer('complete answer'),
    ])
    expect(events.filter((e) => e.type === 'message_end')).toHaveLength(1)
  })

  it('uses native app-state edges even when the WebView stays visible', async () => {
    unbind()
    let nativeState!: (state: { isActive: boolean }) => void
    const remove = vi.fn()
    const host = window as Window & { Capacitor?: unknown }
    host.Capacitor = {
      Plugins: {
        App: {
          addListener: vi.fn((_event, listener) => {
            nativeState = listener
            return Promise.resolve({ remove })
          }),
        },
      },
    }
    unbind = bindAppSuspension(appSuspension, document, window)
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        if (requests.length === 1) {
          nativeState({ isActive: false })
          expect(document.visibilityState).toBe('visible')
          yield { type: 'error', error: 'Network connection lost' }
        } else yield { type: 'done', message: answer('complete') }
      }
    )
    try {
      const { done } = run()
      await flush()
      nativeState({ isActive: true })
      await done
      expect(requests).toHaveLength(2)
      unbind()
      await flush()
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      Reflect.deleteProperty(host, 'Capacitor')
    }
  })

  it('recovers after a frozen host gap without any DOM visibility event', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        if (requests.length === 1) {
          yield { type: 'text_delta', delta: 'partial' }
          vi.setSystemTime(Date.now() + 40_000)
          yield { type: 'error', error: 'Load failed' }
        } else yield { type: 'done', message: answer('complete') }
      }
    )
    const { done } = run()
    const result = await done
    expect(document.visibilityState).toBe('visible')
    expect(requests).toHaveLength(2)
    expect(result.messages.at(-1)).toEqual(answer('complete'))
  })

  it('recognizes a WebKit load failure across backgrounding', async () => {
    droppingProvider('Load failed')
    const { done } = run()
    await flush()
    visible()
    await done
    expect(requests).toHaveLength(2)
  })

  it('does not retry an unrelated foreground failure', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        yield { type: 'error', error: 'Network connection lost' }
      }
    )
    const { done } = run()
    await done
    hidden()
    visible()
    expect(requests).toHaveLength(1)
  })

  it('lets a healthy stream finish after return without reconnecting', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        hidden()
        await vi.advanceTimersByTimeAsync(40_000)
        visible()
        yield { type: 'text_delta', delta: 'complete' }
        yield { type: 'done', message: answer('complete') }
      }
    )
    const { done } = run()
    await done
    await vi.advanceTimersByTimeAsync(3000)
    expect(requests).toHaveLength(1)
  })

  it('does not start another request when the host unloads while waiting', async () => {
    droppingProvider()
    const { done } = run()
    await flush()
    unbind()
    await done
    visible()
    expect(requests).toHaveLength(1)
  })

  it('returns to normal error handling if reconnecting also fails in the foreground', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        if (requests.length === 1) hidden()
        yield { type: 'error', error: 'Network connection lost' }
      }
    )
    const { done } = run()
    await flush()
    visible()
    const result = await done
    expect(requests).toHaveLength(2)
    expect(result.messages).toHaveLength(1)
  })

  it('never resumes a user-stopped turn', async () => {
    droppingProvider()
    const { loop, done } = run()
    await flush()
    loop.abort()
    visible()
    await done
    expect(requests).toHaveLength(1)
  })

  it('does not resume an authentication refusal just because the app was hidden', async () => {
    droppingProvider('HTTP 401: refused')
    const { done } = run()
    await done
    visible()
    expect(requests).toHaveLength(1)
  })

  it('does not replay completed tools when the following stream drops', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'saved' }] })
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        if (requests.length === 1)
          yield {
            type: 'done',
            message: {
              ...answer(''),
              stopReason: 'toolUse',
              content: [
                { type: 'toolCall', id: 'sample-call', name: 'sample_write', arguments: {} },
              ],
            },
          }
        else if (requests.length === 2) {
          yield { type: 'text_delta', delta: 'partial' }
          hidden()
          yield { type: 'error', error: 'Network connection lost' }
        } else yield { type: 'done', message: answer('saved once') }
      }
    )
    const { done } = run(
      [],
      [{ name: 'sample_write', label: 'Sample', description: '', parameters: {}, execute }]
    )
    await flush()
    visible()
    const result = await done
    expect(execute).toHaveBeenCalledTimes(1)
    expect(requests[2]).toEqual(requests[1])
    expect(result.messages.filter((m) => m.role === 'toolResult')).toHaveLength(1)
  })

  it('does not cancel a running tool on return or duplicate its result', async () => {
    let finish!: () => void
    const execute = vi.fn(
      async (_id: string, _args: Record<string, unknown>, _signal?: AbortSignal) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { content: [{ type: 'text' as const, text: 'saved' }] }
      }
    )
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages) {
        requests.push(structuredClone(messages))
        yield {
          type: 'done',
          message:
            requests.length === 1
              ? {
                  ...answer(''),
                  stopReason: 'toolUse',
                  content: [
                    { type: 'toolCall', id: 'sample-call', name: 'sample_write', arguments: {} },
                  ],
                }
              : answer('finished'),
        }
      }
    )
    const { done } = run(
      [],
      [{ name: 'sample_write', label: 'Sample', description: '', parameters: {}, execute }]
    )
    await flush()
    hidden()
    await vi.advanceTimersByTimeAsync(40_000)
    visible()
    await vi.advanceTimersByTimeAsync(3000)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][2]?.aborted).not.toBe(true)
    finish()
    const result = await done
    expect(result.messages.filter((m) => m.role === 'toolResult')).toHaveLength(1)
  })

  it('does not abort a slow model if background timers kept running', async () => {
    let complete!: () => void
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages, _tools, opts) {
        requests.push(structuredClone(messages))
        await new Promise<void>((resolve) => {
          complete = resolve
        })
        expect(opts?.signal?.aborted).toBe(false)
        yield { type: 'done', message: answer('complete') }
      }
    )
    const { done } = run()
    await flush()
    hidden()
    await vi.advanceTimersByTimeAsync(40_000)
    visible()
    await vi.advanceTimersByTimeAsync(3000)
    complete()
    await done
    expect(requests).toHaveLength(1)
  })

  it('abandons a stale transport on return without aborting or replaying a tool', async () => {
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _prompt, messages, _tools, opts) {
        requests.push(structuredClone(messages))
        if (requests.length === 1) {
          yield { type: 'text_delta', delta: 'partial' }
          await new Promise<void>((resolve) =>
            opts?.signal?.addEventListener('abort', () => resolve(), { once: true })
          )
          yield { type: 'done', message: { ...answer('partial'), stopReason: 'aborted' } }
        } else yield { type: 'done', message: answer('complete') }
      }
    )
    const { done } = run()
    await flush()
    hidden()
    // No timer callbacks execute during a WebView suspension; wall-clock time still passes.
    vi.setSystemTime(Date.now() + 40_000)
    // A delayed heartbeat may run before WebKit delivers visibilitychange.
    appSuspension.heartbeat()
    visible()
    await vi.advanceTimersByTimeAsync(1500)
    const result = await done
    expect(requests).toHaveLength(2)
    expect(result.messages.at(-1)).toEqual(answer('complete'))
  })
})
