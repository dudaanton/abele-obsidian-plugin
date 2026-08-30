/**
 * Whether the chat looks busy while it is busy.
 *
 * A turn that stops for approval hands the reader a queue of calls, not one: the model asks
 * for several at a time, and "allow all" lets the rest of them through without another word.
 * Only the call approved by hand was ever marked as running, so everything that followed it
 * ran with the composer showing its idle buttons — no spinner, a greyed send arrow where the
 * stop square belongs, and no way at all to call off a script that had decided to take its
 * time. The agent was working; the chat said it was waiting.
 *
 * The loop is faked because none of this is about a model: what matters is a turn that pauses
 * with more than one call queued behind it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

const reply = (text: string): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 1,
  }) as unknown as Message

const call = (id: string): ToolCallContent => ({
  type: 'toolCall',
  id,
  name: 'demo',
  arguments: { n: id },
})

let session: ChatSession

/** What the composer reads to decide between a stop square and its idle buttons. */
const looksBusy = () => session.isStreaming.value || session.isExecutingTool.value

/** Recorded once per call the tool runs: how the chat looked while it was running. */
let whileRunning: { id: string; busy: boolean; stoppable: boolean }[]

const demoTool = (): AgentTool => ({
  name: 'demo',
  label: 'Demo',
  description: 'A tool that does nothing, slowly enough to be looked at.',
  parameters: {},
  execute: async (_id, params, signal) => {
    whileRunning.push({
      id: String(params.n),
      busy: looksBusy(),
      stoppable: Boolean(signal),
    })
    return { content: [{ type: 'text' as const, text: 'done' }] }
  },
})

/** Turns taken by the model, so a queue that runs out can be seen going back to it. */
let turns: ReturnType<typeof vi.spyOn>

/** A turn that asks for several calls at once and then, once they are answered, says its piece. */
const loopPausingWith = (...ids: string[]) => {
  let turn = 0
  turns = vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    turn++
    if (turn === 1) return { messages: [...opts.messages], pausedAt: ids.map(call) }
    return { messages: [...opts.messages, reply('all done')] }
  })
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }

  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(session as unknown as { getTools: () => AgentTool[] }, 'getTools').mockReturnValue([
    demoTool(),
  ])

  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')

  whileRunning = []
})

/** Gets the chat as far as the first call waiting to be approved. */
const askedAbout = async (...ids: string[]) => {
  loopPausingWith(...ids)
  await session.sendMessage('add the cards')
  expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(ids)
  expect(looksBusy()).toBe(false)
}

describe('the calls that follow the one that was approved', () => {
  it('leave the chat looking busy while they run', async () => {
    await askedAbout('one', 'two', 'three')

    // "Allow all": this tool stops being asked about, and the first call goes through.
    session.toolModes.value = { demo: 'auto' }
    await session.approveToolCall()

    expect(whileRunning.map((r) => r.id)).toEqual(['one', 'two', 'three'])
    expect(whileRunning.filter((r) => !r.busy)).toEqual([])
  })

  it('can be stopped, like the one that was approved by hand', async () => {
    await askedAbout('one', 'two')

    session.toolModes.value = { demo: 'auto' }
    await session.approveToolCall()

    expect(whileRunning.filter((r) => !r.stoppable)).toEqual([])
  })
})

describe('a queue that runs itself out', () => {
  it('leaves the chat idle once the agent has finished with it', async () => {
    await askedAbout('one', 'two')

    session.toolModes.value = { demo: 'auto' }
    await session.approveToolCall()

    expect(looksBusy()).toBe(false)
    expect(session.pendingToolCalls.value).toEqual([])
  })

  it('goes back to the model rather than stopping at the last call', async () => {
    await askedAbout('one', 'two')
    expect(turns).toHaveBeenCalledTimes(1)

    session.toolModes.value = { demo: 'auto' }
    await session.approveToolCall()

    expect(turns).toHaveBeenCalledTimes(2)
  })
})

describe('a call still waiting to be asked about', () => {
  it('holds the queue rather than being run behind the reader', async () => {
    await askedAbout('one', 'two')

    // Approving one call is not approving the next: the mode still says ask.
    await session.approveToolCall()

    expect(whileRunning.map((r) => r.id)).toEqual(['one'])
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['two'])
    expect(looksBusy()).toBe(false)
  })
})
