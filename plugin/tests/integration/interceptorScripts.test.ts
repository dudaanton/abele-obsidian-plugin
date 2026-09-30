/**
 * A chat's interceptor narrowed by a pattern, and a script acting as one.
 *
 * What is asserted is what becomes of a message the person sends: whether the chat's agent is
 * asked, with which text, whether a reviewer or a script sees it first, and what the script's
 * decision does to the turn — its tool calls included. The script itself is stood in for here
 * (running one is `tests/unit/interceptorScripts.test.ts`); the model's loop is faked just far
 * enough to call the approval hook the way the real one does.
 *
 * The one rule over all of it: the message is never lost. A script that fails sends it as
 * written and says why; a script that is stopped keeps it back for the person.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider, type ChatMetadata } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import type { InterceptOutcome } from '@/ai/interceptor/runScript'
import type { InterceptInput } from '@/ai/interceptor/context'
import { toolPolicy } from '@/ai/interceptor/policy'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

/** What the stand-in script decides, and what it was shown. */
const script = vi.hoisted(() => ({
  decide: null as null | ((input: unknown, signal: AbortSignal) => Promise<unknown>),
  seen: [] as unknown[],
}))

vi.mock('@/ai/interceptor/runScript', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return {
    ...real,
    runInterceptorScript: async (_name: string, input: unknown, signal: AbortSignal) => {
      script.seen.push(input)
      return script.decide!(input, signal)
    },
  }
})

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream() {
      yield { type: 'text_delta' as const, delta: 'Reviewed.' }
    }
  }
  return { OpenAIClient }
})

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

const call = (id: string, name = 'demo'): ToolCallContent => ({
  type: 'toolCall',
  id,
  name,
  arguments: { n: id },
})

const textOf = (m: Message): string => {
  const c = (m as { content: unknown }).content
  if (typeof c === 'string') return c
  return (c as { type: string; text?: string }[]).map((p) => p.text ?? '').join('')
}

let session: ChatSession
/** The text of the last person's message in each request to the model. */
let asked: string[]
let ran: string[]
let blocked: { id: string; reason: string }[]
/** Per turn: tool calls to make, or nothing. Turns past the end just answer. */
let turnsPlan: ToolCallContent[][]
let saved: ChatMetadata | null

const tool = (name: string): AgentTool => ({
  name,
  label: name,
  description: 'A tool that does nothing.',
  parameters: {},
  execute: async (id) => {
    ran.push(id)
    return { content: [{ type: 'text' as const, text: 'done' }] }
  },
})

function fakeLoop() {
  let turn = 0
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    const messages = [...opts.messages]
    messages.push(...((await opts.beforeIteration?.()) ?? []))
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    asked.push(lastUser ? textOf(lastUser) : '')
    const calls = turnsPlan[turn++] ?? []
    for (let k = 0; k < calls.length; k++) {
      const c = calls[k]
      const hook = await opts.beforeToolCall?.(c.name, c.id, c.arguments)
      if (hook?.pause) return { messages, pausedAt: calls.slice(k) }
      if (hook?.block) {
        blocked.push({ id: c.id, reason: hook.reason ?? '' })
        continue
      }
      await opts.tools.find((t) => t.name === c.name)!.execute(c.id, c.arguments)
    }
    messages.push(reply('done'))
    return { messages }
  })
}

const registry = () => AgentRegistry.getInstance()

function setup(agentFields: Record<string, unknown> = {}) {
  const reviewer = registry().create({ name: 'Reviewer', providerId: 'p1', modelId: 'big' })
  const main = registry().create({
    name: 'Main',
    providerId: 'p1',
    modelId: 'big',
    ...agentFields,
  })
  registry().setDefault(main.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockImplementation(async () => {
    saved =
      (session as unknown as { snapshot: () => { metadata: ChatMetadata } }).snapshot?.()
        .metadata ?? null
  })
  vi.spyOn(session as unknown as { getTools: () => AgentTool[] }, 'getTools').mockReturnValue([
    tool('demo'),
    tool('other'),
  ])
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
    vi.spyOn(summarizer, k).mockResolvedValue(undefined)
  }
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  return { reviewer, main }
}

const decides = (outcome: InterceptOutcome) => {
  script.decide = async () => outcome
}

const bubbles = () =>
  session.messages.value.filter((m) => m.role === 'user' || m.role === 'assistant')

destroyChatsAfterEach()

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  asked = []
  ran = []
  blocked = []
  turnsPlan = []
  saved = null
  script.decide = null
  script.seen.length = 0
  Notice.shown.length = 0
  fakeLoop()
})

describe('a pattern on a reviewing agent', () => {
  it('sends a message that does not match straight to the chat agent', async () => {
    const { reviewer } = setup()
    session.interceptor.agentId.value = reviewer.id
    session.interceptor.pattern.value = '^/check'

    await session.sendMessage('just a question')

    expect(asked).toEqual(['just a question'])
    expect(session.messages.value.some((m) => m.draft)).toBe(false)
  })

  it('holds one that matches for the reviewer, as before', async () => {
    const { reviewer } = setup()
    session.interceptor.agentId.value = reviewer.id
    session.interceptor.pattern.value = '^/check'

    await session.sendMessage('/check this')

    expect(asked).toEqual([])
    const draft = session.messages.value.find((m) => m.draft)
    expect(draft?.interceptorChat?.[0]?.content).toBe('Reviewed.')
  })

  it("comes from the agent's own settings", async () => {
    const { reviewer } = setup()
    const main = registry().create({
      name: 'Guarded',
      providerId: 'p1',
      modelId: 'big',
      interceptorAgentId: reviewer.id,
      interceptorPattern: '^/check',
    })
    session.switchAgent(main.id)
    expect(session.interceptor.pattern.value).toBe('^/check')
    await session.sendMessage('plain')
    expect(asked).toEqual(['plain'])
  })
})

describe('a script interceptor', () => {
  it('is shown the message and the chat around it', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    decides({ kind: 'send', text: 'first', attachments: [], rewritten: false })
    await session.sendMessage('first')
    await session.sendMessage('second')

    const input = script.seen[1] as InterceptInput
    expect(input.message.text).toBe('second')
    // The faked loop answers without drawing a bubble, so the earlier message is the only one.
    expect(input.chat.messages.map((m) => m.text)).toEqual(['first'])
    expect(input.chat.agent?.name).toBe('Main')
    expect(Object.isFrozen(input.chat.messages)).toBe(true)
  })

  it('only sees messages matching its pattern', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    session.interceptor.pattern.value = '/^\\/todo/i'
    decides({ kind: 'send', text: 'REWRITTEN', attachments: [], rewritten: true })

    await session.sendMessage('nothing to see')
    await session.sendMessage('/TODO buy bread')

    expect(script.seen).toHaveLength(1)
    expect(asked).toEqual(['nothing to see', 'REWRITTEN'])
  })

  it('rewrites the message the agent is asked, and shows what was typed beside it', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    decides({ kind: 'send', text: 'rewritten text', attachments: [], rewritten: true })

    await session.sendMessage('typed text')

    expect(asked).toEqual(['rewritten text'])
    const [user] = bubbles()
    expect(user.content).toBe('rewritten text')
    expect(user.draft).toBe(false)
    expect(user.interceptorChat?.[0]?.content).toContain('typed text')
  })

  it("answers in the agent's place, which never asks the agent", async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    decides({ kind: 'reply', text: 'Added to the list.' })

    await session.sendMessage('/todo bread')

    expect(asked).toEqual([])
    expect(bubbles().map((m) => [m.role, m.content])).toEqual([
      ['user', '/todo bread'],
      ['assistant', 'Added to the list.'],
    ])
    // Both are in the history the next turn is built from.
    decides({ kind: 'send', text: 'and?', attachments: [], rewritten: false })
    await session.sendMessage('and?')
    const internal = (session as unknown as { allInternalMessages: Message[] }).allInternalMessages
    expect(internal.slice(0, 2).map(textOf)).toEqual(['/todo bread', 'Added to the list.'])
  })

  it('holds the message back as a draft with the reason, for the person to send', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    decides({ kind: 'hold', reason: 'It names a password.' })

    await session.sendMessage('the password is swordfish')

    expect(asked).toEqual([])
    const draft = session.messages.value.find((m) => m.draft)!
    expect(draft.content).toBe('the password is swordfish')
    expect(draft.interceptorScript).toBe(true)
    expect(draft.interceptorChat?.[0]?.content).toBe('It names a password.')

    await session.confirmDraft(draft.id)
    expect(asked).toEqual(['the password is swordfish'])
  })

  it('sends the message as written when the script fails, and says why', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    decides({ kind: 'failed', reason: 'the script did not decide within 30 s' })

    await session.sendMessage('as typed')

    expect(asked).toEqual(['as typed'])
    const [user] = bubbles()
    expect(user.draft).toBe(false)
    expect(user.interceptorCollapsed).toBe(false)
    expect(user.interceptorChat?.[0]?.content).toContain('did not decide within 30 s')
    expect(Notice.shown.join('\n')).toContain('did not decide within 30 s')
  })

  it('keeps the message back when the person stops it', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    script.decide = (_input, signal) =>
      new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'stopped' })))

    const sending = session.sendMessage('wait for it')
    await vi.waitFor(() => expect(session.interceptor.working.value).toBe(true))
    session.abort()
    await sending

    expect(asked).toEqual([])
    expect(session.messages.value.find((m) => m.draft)?.content).toBe('wait for it')
  })

  it('queues what is sent while it decides, and runs that past it too', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    let release: () => void = () => {}
    script.decide = async (input) => {
      const text = (input as InterceptInput).message.text
      if (text === 'first') await new Promise<void>((r) => (release = r))
      return { kind: 'send', text: text.toUpperCase(), attachments: [], rewritten: true }
    }

    const first = session.sendMessage('first')
    await vi.waitFor(() => expect(session.interceptor.working.value).toBe(true))
    await session.sendMessage('second')
    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['second'])

    release()
    await first
    await vi.waitFor(() => expect(asked).toEqual(['FIRST', 'SECOND']))
  })

  it('keeps its choice and pattern when the chat is saved and opened again', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    session.interceptor.pattern.value = '^/todo'
    const snapshot = (
      session as unknown as { snapshot: () => { metadata: ChatMetadata } }
    ).snapshot()
    expect(snapshot.metadata.interceptorScript).toBe('Guard')
    expect(snapshot.metadata.interceptorPattern).toBe('^/todo')
  })

  it("comes from the agent's own settings, and wins over its reviewer", async () => {
    const { reviewer } = setup()
    const guarded = registry().create({
      name: 'Guarded',
      providerId: 'p1',
      modelId: 'big',
      interceptorAgentId: reviewer.id,
      interceptorScript: 'Guard',
    })
    session.switchAgent(guarded.id)
    decides({ kind: 'send', text: 'via script', attachments: [], rewritten: true })
    await session.sendMessage('hello')
    expect(asked).toEqual(['via script'])
  })
})

describe("a script's say over the turn's tool calls", () => {
  const withPolicy = (approve: unknown, deny: string[] = []) =>
    decides({
      kind: 'send',
      text: 'go',
      attachments: [],
      rewritten: false,
      policy: toolPolicy({ approve: approve as never, deny }, 'Guard'),
    })

  it.each([true, ['demo'], () => true])(
    'ignores approval %j in reply-only mode',
    async (approve) => {
      setup()
      session.interceptor.script.value = 'Guard'
      session.interceptor.replyOnly.value = true
      withPolicy(approve)
      turnsPlan = [[call('c1')]]
      await session.sendMessage('go')
      expect(ran).toEqual([])
      expect(blocked).toEqual([])
      expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c1'])
      await vi.waitFor(() =>
        expect(session.messages.value[0].interceptorChat?.[0].content).toMatch(
          /ignored tool-approval/
        )
      )
    }
  )

  it('never invokes a reply-only approval callback', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    session.interceptor.replyOnly.value = true
    const approve = vi.fn(() => true)
    withPolicy(approve)
    turnsPlan = [[call('c1')]]
    await session.sendMessage('go')
    await vi.waitFor(() =>
      expect(session.messages.value[0].interceptorChat?.[0].content).toMatch(
        /ignored tool-approval/
      )
    )
    expect(approve).not.toHaveBeenCalled()
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c1'])
  })

  it('ignores denial in reply-only mode and keeps asking as usual', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    session.interceptor.replyOnly.value = true
    withPolicy(true, ['demo'])
    turnsPlan = [[call('c1')]]
    await session.sendMessage('go')
    expect(blocked).toEqual([])
    expect(ran).toEqual([])
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c1'])
  })

  it('runs a call it approves without asking', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    withPolicy(['demo'])
    turnsPlan = [[call('c1')]]

    await session.sendMessage('go')

    expect(ran).toEqual(['c1'])
    expect(session.pendingToolCalls.value).toEqual([])
  })

  it('refuses a call it denies, in its own name', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    withPolicy(true, ['demo'])
    turnsPlan = [[call('c1')]]

    await session.sendMessage('go')

    expect(ran).toEqual([])
    expect(blocked[0].reason).toContain('Guard')
  })

  it('asks about a call it has no answer for', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    withPolicy(['other'])
    turnsPlan = [[call('c1', 'demo')]]

    await session.sendMessage('go')

    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c1'])
  })

  it('answers for the calls queued behind one the person approved', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    withPolicy(['other'], ['rm'])
    turnsPlan = [[call('c1', 'demo'), call('c2', 'other'), call('c3', 'demo')]]

    await session.sendMessage('go')
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])

    await session.approveToolCall()
    // c2 ran on the script's word; c3 is asked about.
    expect(ran).toEqual(['c1', 'c2'])
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c3'])
  })

  it('does not run a call it approves after the chat was stopped', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    let answer: (yes: boolean) => void = () => {}
    withPolicy(() => new Promise<boolean>((r) => (answer = r)))
    turnsPlan = [[call('c1')]]

    const sending = session.sendMessage('go')
    await vi.waitFor(() => expect(asked).toEqual(['go']))
    session.abort()
    answer(true)
    await sending

    expect(ran).toEqual([])
  })

  it('ends with the turn: the next message starts without it', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    withPolicy(true)
    turnsPlan = [[call('c1')], [call('c2')]]

    await session.sendMessage('go')
    expect(ran).toEqual(['c1'])

    session.interceptor.script.value = ''
    await session.sendMessage('again')
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c2'])
  })

  it('is not shown messages typed into a running turn, and ends when one joins it', async () => {
    setup()
    session.interceptor.script.value = 'Guard'
    session.interceptor.pattern.value = '^/todo'
    withPolicy(true)
    turnsPlan = [[call('c9')]]

    const running = session.sendMessage('/todo one')
    // Typed while the script decides: queued, and handed to the turn at its next iteration.
    session.queuedMessages.value = [
      { id: 'q1', content: 'plain words' },
      { id: 'q2', content: '/todo two' },
    ]
    await running

    // The plain message joined the turn; the script never saw it, so its yes no longer holds.
    expect(asked).toEqual(['plain words'])
    expect(session.pendingToolCalls.value.map((c) => c.id)).toEqual(['c9'])
    // The one the script would take was not slipped into the turn past it: it waits its turn.
    expect(session.queuedMessages.value.map((q) => q.content)).toEqual(['/todo two'])
    expect(script.seen).toHaveLength(1)
  })
})
