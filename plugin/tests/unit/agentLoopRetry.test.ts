/**
 * What a failed turn leaves behind.
 *
 * A request that errored produced no answer, so it must leave the conversation exactly as it
 * was — otherwise "retry" is not a retry: it sends the history *plus* an empty assistant turn,
 * and a provider handed two assistant turns in a row, or one with no content, refuses the lot.
 * That is the bug this file exists for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AssistantMessage, Message, ModelConfig } from '@/ai/client'

const model = { id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10 } as unknown as ModelConfig

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 }) as never

const turn = (over: Partial<AssistantMessage>): AssistantMessage =>
  ({
    role: 'assistant',
    content: [],
    model: 'big',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
    ...over,
  }) as AssistantMessage

let requests: Message[][]

const streams = (message: AssistantMessage, event: 'done' | 'error' = 'done') => {
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _system, messages) {
      requests.push([...(messages as Message[])])
      yield event === 'done'
        ? { type: 'done' as const, message }
        : { type: 'error' as const, error: message.errorMessage ?? 'failed', message }
    } as never
  )
}

const run = (messages: Message[]) =>
  new AgentLoop().run({ model, systemPrompt: '', tools: [], messages })

beforeEach(() => {
  requests = []
  vi.restoreAllMocks()
})

describe('a turn the provider failed', () => {
  it('is left out of the conversation, which is what makes a retry a retry', async () => {
    streams(turn({ stopReason: 'error', errorMessage: 'Overloaded' }), 'error')

    const result = await run([user('summarise these notes')])

    expect(result.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('is left out when the provider simply said nothing at all', async () => {
    // A provider that closed the connection saying nothing at all.
    vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {} as never)

    const result = await run([user('summarise these notes')])

    expect(result.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('asks the model the very same thing when the conversation is sent again', async () => {
    streams(turn({ stopReason: 'error', errorMessage: 'Overloaded' }), 'error')
    const history = [user('summarise these notes')]

    const first = await run(history)
    await run(first.messages)

    expect(requests[1]).toEqual(requests[0])
  })

  /** The error still has to reach whoever is watching, or the chat shows nothing at all. */
  it('is still announced, so the chat can say what went wrong', async () => {
    streams(turn({ stopReason: 'error', errorMessage: 'Overloaded' }), 'error')
    const seen: string[] = []
    const loop = new AgentLoop()
    loop.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        seen.push(String(event.message.errorMessage ?? ''))
      }
    })

    await loop.run({ model, systemPrompt: '', tools: [], messages: [user('hello')] })

    expect(seen).toContain('Overloaded')
  })
})

describe('a turn the reader stopped', () => {
  /** Aborting is not failing: whatever the model had said by then is real and stays. */
  it('keeps what had already been said', async () => {
    streams(turn({ stopReason: 'aborted', content: [{ type: 'text', text: 'half an ans' }] }))

    const result = await run([user('summarise these notes')])

    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})

describe('an ordinary turn', () => {
  it('stays in the conversation', async () => {
    streams(turn({ content: [{ type: 'text', text: 'here you go' }] }))

    const result = await run([user('summarise these notes')])

    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})
