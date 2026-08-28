/**
 * What the loop is allowed to add to a conversation it is already running.
 *
 * `beforeIteration` exists for one reason: a message typed while the agent is working should
 * reach the model at its next request rather than after the whole turn. The session decides
 * what to hand over; the loop's part of the contract is asking every time — including before
 * the first request — and putting what it is given in front of the model.
 *
 * The transport is stubbed with a scripted stream, so what a request carried can be read off
 * the call rather than inferred from an answer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { Message, ModelConfig } from '@/ai/client'

const model = {
  id: 'big',
  name: 'Big',
  contextWindow: 100,
  maxTokens: 10,
} as unknown as ModelConfig

const assistant = (text: string) => ({
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text }],
  model: 'big',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  stopReason: 'stop' as const,
  timestamp: 1,
})

const user = (text: string): Message =>
  ({ role: 'user', content: text, timestamp: 1 }) as unknown as Message

/** Every set of messages the loop asked the model about. */
let requests: Message[][]

beforeEach(() => {
  requests = []
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(
    async function* (_model, _system, messages) {
      requests.push([...(messages as Message[])])
      yield { type: 'done' as const, message: assistant(`answer ${requests.length}`) }
    } as never
  )
})

const run = (opts: Partial<Parameters<AgentLoop['run']>[0]> = {}) =>
  new AgentLoop().run({
    model,
    systemPrompt: '',
    tools: [],
    messages: [user('summarise these notes')],
    ...opts,
  })

describe('messages handed to a loop already running', () => {
  it('are asked for before the request, and go to the model with it', async () => {
    await run({ beforeIteration: () => [user('and also check the dates')] })

    expect(requests[0].map((m) => m.content)).toEqual([
      'summarise these notes',
      'and also check the dates',
    ])
  })

  it('are asked for again at every iteration, not only the first', async () => {
    let asked = 0
    await run({
      beforeIteration: () => {
        asked++
        return []
      },
    })

    expect(asked).toBe(1)
  })

  it('are part of what the loop returns, so the conversation keeps them', async () => {
    const result = await run({ beforeIteration: () => [user('and also check the dates')] })

    expect(result.messages.map((m) => m.content)).toEqual([
      'summarise these notes',
      'and also check the dates',
      [{ type: 'text', text: 'answer 1' }],
    ])
  })

  it('are optional — a loop without the hook asks the model exactly what it was given', async () => {
    await run()

    expect(requests[0].map((m) => m.content)).toEqual(['summarise these notes'])
  })
})
