/**
 * What a chat looks like after a request failed, and what "retry" then sends.
 *
 * A failed request produced no answer, so the conversation must be exactly where it was: the
 * error is shown, nothing is added, and pressing retry sends the same history again. It used
 * to append an empty assistant bubble instead — visible in the chat, and, worse, handed to the
 * provider on the retry, which refused a conversation ending in an assistant turn with nothing
 * in it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AssistantMessage, Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

const failed = (message: string): AssistantMessage =>
  ({
    role: 'assistant',
    content: [],
    model: 'big',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'error',
    errorMessage: message,
    timestamp: 1,
  }) as AssistantMessage

const answered = (text: string): AssistantMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'big',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  }) as AssistantMessage

let session: ChatSession
/** Every conversation the loop was asked to run, as it was handed over. */
let sent: Message[][]

/** A loop that behaves like the real one: announces the turn, keeps a failed one out. */
function loopThat(turns: AssistantMessage[], events: unknown[] = []) {
  let at = 0
  return vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async function (
    this: AgentLoop,
    opts
  ) {
    sent.push([...opts.messages])
    const turn = turns[Math.min(at++, turns.length - 1)]
    const emit = (this as unknown as { emit: (event: unknown) => void }).emit.bind(this)

    for (const event of events) emit(event)
    emit({ type: 'message_end', message: turn })
    return { messages: turn.stopReason === 'error' ? [...opts.messages] : [...opts.messages, turn] }
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  sent = []
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }

  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
})

const roles = () => session.allMessages.value.map((m) => m.role)

describe('a request that failed', () => {
  it('says what went wrong', async () => {
    loopThat([failed('Provider overloaded')])

    await session.sendMessage('summarise these notes')

    expect(session.error.value).toBe('Provider overloaded')
  })

  it('leaves nothing behind in the conversation', async () => {
    loopThat([failed('Provider overloaded')])

    await session.sendMessage('summarise these notes')

    expect(roles()).toEqual(['user'])
  })
})

describe('pressing retry', () => {
  it('sends exactly what failed, not that plus an empty turn', async () => {
    loopThat([failed('Provider overloaded'), answered('here you go')])

    await session.sendMessage('summarise these notes')
    await session.retryRequest()

    expect(sent[1]).toEqual(sent[0])
  })

  it('leaves the chat with one question and one answer', async () => {
    loopThat([failed('Provider overloaded'), answered('here you go')])

    await session.sendMessage('summarise these notes')
    await session.retryRequest()

    expect(roles()).toEqual(['user', 'assistant'])
  })

  it('clears the error once it goes through', async () => {
    loopThat([failed('Provider overloaded'), answered('here you go')])

    await session.sendMessage('summarise these notes')
    await session.retryRequest()

    expect(session.error.value).toBeNull()
  })

  /** Twice failed is still one question: the conversation does not grow with the attempts. */
  it('does not pile up turns when it fails again', async () => {
    // Fails every time: the list runs out and the last turn repeats.
    loopThat([failed('Overloaded')])

    await session.sendMessage('summarise these notes')
    await session.retryRequest()
    await session.retryRequest()

    expect(roles()).toEqual(['user'])
    expect(sent[2]).toEqual(sent[0])
  })
})

describe('trying again on its own', () => {
  const setRetry = (attempts: number, firstDelayMs = 2000) => {
    AbeleConfig.getInstance().ai = {
      ...AbeleConfig.getInstance().ai,
      autoRetry: { attempts, firstDelayMs },
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Runs the send, letting every countdown between attempts elapse. */
  const sendThrough = async (text = 'summarise these notes') => {
    const done = session.sendMessage(text)
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    await done
  }

  it.each([
    'Request timed out after 300s',
    'Failed to fetch',
    'Model response ended before completion. Retry the request.',
  ])('recovers an empty transport failure automatically: %s', async (error) => {
    const { OpenAIClient } = await import('@/ai/client/OpenAIClient')
    let calls = 0
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
      async function* (_model, _system, messages) {
        if (!messages.some((m) => m.role === 'user' && m.content === 'Sample question')) {
          yield { type: 'done' as const, message: answered('Summary') }
          return
        }
        if (calls++ === 0) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          yield { type: 'error' as const, error, message: failed(error) }
        } else yield { type: 'done' as const, message: answered('recovered') }
      }
    )
    const done = session.sendMessage('Sample question')
    await vi.advanceTimersByTimeAsync(3500)
    expect(session.retrying.value).toMatchObject({ attempt: 1, of: 2 })
    await vi.advanceTimersByTimeAsync(20_000)
    await done
    expect(calls).toBe(2)
    expect(session.error.value).toBeNull()
  })

  it.each(['recover', 'stop', 'close', 'branch'])(
    'handles an empty model failure after a completed tool: %s',
    async (action) => {
      const { OpenAIClient } = await import('@/ai/client/OpenAIClient')
      const execute = vi
        .fn()
        .mockResolvedValue({ content: [{ type: 'text', text: 'Sample tool result' }] })
      vi.spyOn(session, 'getTools').mockReturnValue([
        { name: 'sample_tool', description: 'Sample', parameters: {}, execute },
      ] as never)
      vi.spyOn(session, 'needsApproval').mockReturnValue(false)
      const requests: Message[][] = []
      vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
        async function* (_model, _system, messages) {
          if (!messages.some((m) => m.role === 'user' && m.content === 'Sample question')) {
            yield { type: 'done' as const, message: answered('Summary') }
            return
          }
          requests.push(structuredClone(messages))
          if (requests.length === 1) {
            yield {
              type: 'done' as const,
              message: {
                ...answered(''),
                content: [
                  {
                    type: 'toolCall' as const,
                    id: 'sample-call',
                    name: 'sample_tool',
                    arguments: {},
                  },
                ],
                stopReason: 'toolUse' as const,
              },
            }
          } else if (requests.length === 2) {
            yield {
              type: 'error' as const,
              error: 'Request timed out after 300s',
              message: failed('Request timed out after 300s'),
            }
          } else yield { type: 'done' as const, message: answered('recovered') }
        }
      )

      const done = session.sendMessage('Sample question')
      await vi.advanceTimersByTimeAsync(500)
      expect(session.retrying.value).toMatchObject({ attempt: 1, of: 2 })
      if (action === 'stop') session.abort()
      if (action === 'close') session.destroy()
      if (action === 'branch') {
        // Branch navigation is fenced while a turn (including its retry) is active.
        expect(session.branchSwitchBlocked).toBe(true)
        expect(session.switchBranch(session.allMessages.value[0].id)).toBe(false)
        session.abort()
      }
      await vi.advanceTimersByTimeAsync(20_000)
      await done

      expect(execute).toHaveBeenCalledTimes(1)
      expect(session.retrying.value).toBeNull()
      if (action !== 'recover') {
        expect(requests).toHaveLength(2)
        return
      }
      expect(requests).toHaveLength(3)
      expect(requests[2]).toEqual(requests[1])
      expect(requests[2].map((m) => m.role)).toContain('toolResult')
      expect(session.error.value).toBeNull()
      expect(session.allMessages.value.at(-1)?.content).toBe('recovered')
    }
  )

  it('exhausts two automatic transport retries', async () => {
    loopThat([failed('Failed to fetch')])
    await sendThrough()
    expect(sent).toHaveLength(3)
    expect(session.error.value).toBe('Failed to fetch')
  })

  it('does not repeat partial output even with explicit retries', async () => {
    setRetry(3)
    const partial = failed('Failed to fetch')
    partial.content = [{ type: 'text', text: 'Partial answer' }]
    loopThat([partial, answered('repeated')])
    await sendThrough()
    expect(sent).toHaveLength(1)
  })

  it.each(['text_delta', 'thinking_delta', 'tool_call_start'])(
    'never repeats after %s',
    async (type) => {
      loopThat(
        [failed('Failed to fetch')],
        [
          {
            type: 'stream_event',
            event: {
              type,
              delta: 'Sample',
              toolCallId: 'call-1',
              toolName: 'sample_tool',
            },
          },
        ]
      )
      await sendThrough()
      expect(sent).toHaveLength(1)
    }
  )

  it.each(['stop', 'close'])('cancels the default countdown on %s', async (action) => {
    loopThat([failed('Failed to fetch')])
    const done = session.sendMessage('Sample question')
    await vi.advanceTimersByTimeAsync(500)
    expect(session.retrying.value).not.toBeNull()
    if (action === 'close') session.destroy()
    else session.abort()
    await vi.advanceTimersByTimeAsync(20_000)
    await done
    expect(sent).toHaveLength(1)
    expect(session.retrying.value).toBeNull()
  })

  it('does nothing unless it was asked to', async () => {
    loopThat([failed('HTTP 429: rate limited')])

    await sendThrough()

    expect(sent).toHaveLength(1)
  })

  it.each([
    'HTTP 429: rate limited',
    'Responses request failed: [server_error] Upstream busy',
    'Responses request failed: [rate_limit_exceeded] Slow down',
  ])('tries again when the failure passes: %s', async (error) => {
    setRetry(2)
    loopThat([failed(error), answered('here you go')])

    await sendThrough()

    expect(sent).toHaveLength(2)
    expect(roles()).toEqual(['user', 'assistant'])
  })

  it('gives up after the number of tries it was given', async () => {
    setRetry(2)
    loopThat([failed('HTTP 503: overloaded')])

    await sendThrough()

    expect(sent).toHaveLength(3)
    expect(session.error.value).toContain('overloaded')
  })

  it('presents an unavailable provider while retaining the raw failure for diagnostics and retry', async () => {
    setRetry(1, 3000)
    const raw = 'HTTP 503: {"error":{"message":"Sample service overloaded"}}'
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    loopThat([failed(raw)])
    const done = session.sendMessage('Sample question')
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.errorPresentation.value).toMatchObject({ key: 'streamB.providerUnavailable' })
    expect(session.retrying.value?.secondsLeft).toBe(2)
    expect(log).toHaveBeenCalledWith('[Abele AI]', raw)
    await vi.advanceTimersByTimeAsync(60_000)
    await done
  })

  it.each([
    'HTTP 401: invalid api key',
    'Responses request failed: [invalid_request] Unsupported parameter',
    'Responses request failed: [content_policy_violation] Request rejected',
  ])('does not repeat permanent failure: %s', async (error) => {
    setRetry(3)
    loopThat([failed(error)])

    await sendThrough()

    expect(sent).toHaveLength(1)
  })

  it('waits longer each time', async () => {
    setRetry(3, 2000)
    loopThat([failed('HTTP 503: overloaded')])

    const done = session.sendMessage('summarise these notes')
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(2) // the second wait is four seconds, not two

    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(60_000)
    await done
  })

  it('says what it is waiting for while it waits', async () => {
    setRetry(2, 3000)
    loopThat([failed('HTTP 503: overloaded')])

    const done = session.sendMessage('summarise these notes')
    await vi.advanceTimersByTimeAsync(1000)

    expect(session.retrying.value).toMatchObject({ attempt: 1, of: 2, secondsLeft: 2 })

    await vi.advanceTimersByTimeAsync(60_000)
    await done
  })

  it('stops counting down when the chat is stopped', async () => {
    setRetry(3)
    loopThat([failed('HTTP 503: overloaded')])

    const done = session.sendMessage('summarise these notes')
    await vi.advanceTimersByTimeAsync(500)
    session.abort()
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    expect(sent).toHaveLength(1)
    expect(session.retrying.value).toBeNull()
  })

  it('goes at once when the reader presses retry instead of waiting', async () => {
    setRetry(3, 30_000)
    loopThat([failed('HTTP 503: overloaded'), answered('here you go')])

    const done = session.sendMessage('summarise these notes')
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.retrying.value).toBeTruthy()

    await session.retryRequest()
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    expect(session.retrying.value).toBeNull()
    expect(roles()).toEqual(['user', 'assistant'])
  })
})
