/**
 * Several interceptors over the person's message, one after another.
 *
 * What is asserted is what becomes of a message: which interceptor sees which text, in which
 * order, which are skipped, and where the message waits when one fails — with Retry running that
 * one again and Send as is sending it without the rest. The scripts are stood in for by name; a
 * reviewing agent is a fake completion; the main agent's loop is faked far enough to say what it
 * was asked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider, type ChatMetadata } from '@/ai/types'
import type { InterceptorEntry } from '@/ai/agents/types'
import type { AgentTool, Message } from '@/ai/client'
import type { InterceptOutcome } from '@/ai/interceptor/runScript'
import type { InterceptInput } from '@/ai/interceptor/context'
import { newEntry } from '@/ai/interceptor/entries'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

/** Per script name: what it decides, given the text it was shown. */
const scripts = vi.hoisted(() => ({
  decide: {} as Record<string, (text: string) => Promise<unknown> | unknown>,
  seen: [] as string[],
}))

vi.mock('@/ai/interceptor/runScript', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return {
    ...real,
    runInterceptorScript: async (name: string, input: InterceptInput) => {
      const text = input.message.text
      scripts.seen.push(`${name}: ${text}`)
      return scripts.decide[name](text)
    },
  }
})

const reviewer = vi.hoisted(() => ({ fail: null as string | null, said: [] as string[] }))

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_m: unknown, _s: unknown, messages: { content: unknown }[]) {
      const last = messages.at(-1)!.content
      reviewer.said.push(typeof last === 'string' ? last : JSON.stringify(last))
      if (reviewer.fail) {
        yield { type: 'error' as const, error: reviewer.fail }
        return
      }
      yield { type: 'text_delta' as const, delta: 'Reads fine.' }
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

const textOf = (m: Message): string => {
  const c = (m as { content: unknown }).content
  if (typeof c === 'string') return c
  return (c as { type: string; text?: string }[]).map((p) => p.text ?? '').join('')
}

let session: ChatSession
let asked: string[]

function fakeLoop() {
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    const messages = [...opts.messages]
    messages.push(...((await opts.beforeIteration?.()) ?? []))
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    asked.push(lastUser ? textOf(lastUser) : '')
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'stop',
      timestamp: 1,
    } as unknown as Message)
    return { messages }
  })
}

const registry = () => AgentRegistry.getInstance()

/** A chat on an agent whose list is `list`, with `Reviewer` there to name. */
function setup(list: (reviewerId: string) => InterceptorEntry[]) {
  const rev = registry().create({ name: 'Reviewer', providerId: 'p1', modelId: 'big' })
  const main = registry().create({
    name: 'Main',
    providerId: 'p1',
    modelId: 'big',
    interceptors: list(rev.id),
  })
  registry().setDefault(main.id)
  session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(session as unknown as { getTools: () => AgentTool[] }, 'getTools').mockReturnValue([])
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
    vi.spyOn(summarizer, k).mockResolvedValue(undefined)
  }
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  return { reviewer: rev, main }
}

const script = (name: string, patch: Partial<InterceptorEntry> = {}) =>
  newEntry({ id: `ic-${name}`, script: name, ...patch })

/** A script that appends its name to what it is given. */
const appends = (name: string) => (text: string) =>
  ({
    kind: 'send',
    text: `${text} +${name}`,
    attachments: [],
    rewritten: true,
  }) satisfies InterceptOutcome

const passes = (text: string) =>
  ({ kind: 'send', text, attachments: [], rewritten: false }) satisfies InterceptOutcome

const userBubble = () => session.messages.value.find((m) => m.role === 'user')!

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
  scripts.decide = {}
  scripts.seen.length = 0
  reviewer.fail = null
  reviewer.said.length = 0
  fakeLoop()
})

describe('interceptors over a message, one after another', () => {
  it('gives each one what the one before returned, and the agent the last one’s text', async () => {
    setup(() => [script('First'), script('Second'), script('Third')])
    scripts.decide = { First: appends('1'), Second: appends('2'), Third: appends('3') }

    await session.sendMessage('typed')

    expect(scripts.seen).toEqual(['First: typed', 'Second: typed +1', 'Third: typed +1 +2'])
    expect(asked).toEqual(['typed +1 +2 +3'])
    const bubble = userBubble()
    expect(bubble.draft).toBe(false)
    expect(bubble.content).toBe('typed +1 +2 +3')
    // Each change is said beside it, by who made it.
    expect(bubble.interceptorChat?.map((m) => m.by)).toEqual(['First', 'Second', 'Third'])
    expect(bubble.interceptorWait).toBeUndefined()
  })

  it('skips a switched-off one, one reading answers only, and one whose pattern does not match', async () => {
    setup(() => [
      script('Off', { enabled: false }),
      script('Answers', { checks: 'answer' }),
      script('Fixes', { pattern: '^/fix' }),
      script('Both', { checks: 'both' }),
    ])
    scripts.decide = { Both: passes }

    await session.sendMessage('plain')

    expect(scripts.seen).toEqual(['Both: plain'])
    expect(asked).toEqual(['plain'])
  })

  it('judges a pattern on the text the one before returned', async () => {
    setup(() => [script('Tagger'), script('Tagged only', { pattern: '#tagged$' })])
    scripts.decide = {
      Tagger: (text: string) => ({ ...passes(`${text} #tagged`), rewritten: true }),
      'Tagged only': passes,
    }

    await session.sendMessage('plain')

    expect(scripts.seen).toEqual(['Tagger: plain', 'Tagged only: plain #tagged'])
  })

  it('a reply-only one in the middle comments and passes the text on unchanged', async () => {
    setup(() => [script('First'), script('Commenter', { replyOnly: true }), script('Last')])
    scripts.decide = {
      First: appends('1'),
      Commenter: () => ({ kind: 'reply', text: 'Sample comment.' }),
      Last: appends('3'),
    }

    await session.sendMessage('typed')
    await vi.waitFor(() =>
      expect(userBubble().interceptorChat?.some((m) => m.content === 'Sample comment.')).toBe(true)
    )

    // It runs beside the message, so when it starts against the next one is not its business.
    expect([...scripts.seen].sort()).toEqual(['Commenter: typed +1', 'First: typed', 'Last: typed +1'])
    expect(asked).toEqual(['typed +1 +3'])
  })

  it('reply-only ones alone never hold the message, and comment in their order', async () => {
    let release!: () => void
    const firstDone = new Promise<void>((r) => (release = r))
    setup(() => [script('Slow', { replyOnly: true }), script('Quick', { replyOnly: true })])
    scripts.decide = {
      Slow: async () => {
        await firstDone
        return { kind: 'reply', text: 'Slow comment.' }
      },
      Quick: () => ({ kind: 'reply', text: 'Quick comment.' }),
    }

    await session.sendMessage('typed')
    expect(asked).toEqual(['typed'])
    expect(userBubble().draft).toBeFalsy()
    // The second waits for the first, so they answer in the list's order.
    expect(scripts.seen).toEqual(['Slow: typed'])
    release()
    await vi.waitFor(() =>
      expect(userBubble().interceptorChat?.map((m) => m.content)).toEqual([
        'Slow comment.',
        'Quick comment.',
      ])
    )
  })

  it('a failure stops it at that one: the earlier work stays, the later ones never run', async () => {
    setup(() => [script('First'), script('Breaks'), script('Last')])
    scripts.decide = {
      First: appends('1'),
      Breaks: () => ({ kind: 'failed', reason: 'the script threw' }),
      Last: appends('3'),
    }

    await session.sendMessage('typed')

    expect(asked).toEqual([])
    const bubble = userBubble()
    expect(bubble.draft).toBe(true)
    expect(bubble.content).toBe('typed +1')
    expect(bubble.interceptorWait).toMatchObject({ entry: 'ic-Breaks', at: 2, of: 3 })
    expect(bubble.interceptorWait?.error).toBe(
      'Breaks, 2 of 3: the script threw. Retry, or send it as is.'
    )
    expect(scripts.seen).toEqual(['First: typed', 'Breaks: typed +1'])
  })

  it('Retry runs the failed one again and the rest after it, not the ones before', async () => {
    setup(() => [script('First'), script('Breaks'), script('Last')])
    let broken = true
    scripts.decide = {
      First: appends('1'),
      Breaks: (text: string) =>
        broken ? { kind: 'failed', reason: 'the script threw' } : appends('2')(text),
      Last: appends('3'),
    }
    await session.sendMessage('typed')
    broken = false
    scripts.seen.length = 0

    await session.retryInterceptor(userBubble().id)

    expect(scripts.seen).toEqual(['Breaks: typed +1', 'Last: typed +1 +2'])
    expect(asked).toEqual(['typed +1 +2 +3'])
    expect(userBubble().draft).toBe(false)
  })

  it('Send as is sends it as the failed one got it, without the rest', async () => {
    setup(() => [script('First'), script('Breaks'), script('Last')])
    scripts.decide = {
      First: appends('1'),
      Breaks: () => ({ kind: 'failed', reason: 'the script threw' }),
      Last: appends('3'),
    }
    await session.sendMessage('typed')

    await session.confirmDraft(userBubble().id)

    expect(asked).toEqual(['typed +1'])
    expect(scripts.seen).not.toContain('Last: typed +1')
    expect(userBubble().draft).toBe(false)
  })

  it('a reviewing agent holds it for the person, whose Send goes on with the next one', async () => {
    setup((rev) => [script('First'), newEntry({ id: 'ic-rev', agentId: rev }), script('Last')])
    scripts.decide = { First: appends('1'), Last: appends('3') }

    await session.sendMessage('typed')

    expect(reviewer.said).toEqual(['typed +1'])
    const held = userBubble()
    expect(held.draft).toBe(true)
    expect(held.interceptorWait).toMatchObject({ entry: 'ic-rev', at: 2, of: 3 })
    expect(held.interceptorWait?.error).toBeUndefined()
    expect(held.interceptorChat?.at(-1)).toMatchObject({ content: 'Reads fine.', by: 'Reviewer' })
    expect(asked).toEqual([])

    session.updateDraftContent(held.id, 'typed +1 edited')
    await session.confirmDraft(held.id)

    expect(scripts.seen.at(-1)).toBe('Last: typed +1 edited')
    expect(asked).toEqual(['typed +1 edited +3'])
  })

  it('a reviewing agent that fails stops it there with its name and place', async () => {
    setup((rev) => [newEntry({ id: 'ic-rev', agentId: rev }), script('Last')])
    scripts.decide = { Last: appends('2') }
    reviewer.fail = 'Sample reviewer offline'

    await session.sendMessage('typed')

    expect(userBubble().interceptorWait?.error).toBe(
      'Reviewer, 1 of 2: Sample reviewer offline. Retry, or send it as is.'
    )
    reviewer.fail = null
    await session.retryInterceptor(userBubble().id)
    expect(userBubble().interceptorWait).toMatchObject({ at: 1, of: 2 })
    expect(userBubble().interceptorWait?.error).toBeUndefined()
    await session.confirmDraft(userBubble().id)
    expect(asked).toEqual(['typed +2'])
  })
})

describe("a chat's own list", () => {
  it('runs in place of the agent’s, and comes back from disk as it was', async () => {
    setup(() => [script('Agent own')])
    scripts.decide = { 'Chat first': appends('a'), 'Chat second': appends('b') }
    session.interceptor.setEntries([
      script('Chat first'),
      script('Chat second', { checks: 'both' }),
    ])

    await session.sendMessage('typed')
    expect(scripts.seen).toEqual(['Chat first: typed', 'Chat second: typed +a'])

    const metadata = (
      session as unknown as { snapshot: () => { metadata: ChatMetadata } }
    ).snapshot().metadata
    expect(metadata.interceptors?.map((e) => e.script)).toEqual(['Chat first', 'Chat second'])
    // Older builds read the first one.
    expect(metadata.interceptorScript).toBe('Chat first')

    const reopened = new ChatSession(ChatService.getInstance())
    ;(reopened as unknown as { restoreInterceptor: (m: ChatMetadata) => void }).restoreInterceptor(
      metadata
    )
    expect(reopened.interceptor.entries.value.map((e) => e.script)).toEqual([
      'Chat first',
      'Chat second',
    ])
    expect(reopened.interceptor.followsAgent).toBe(false)
    reopened.destroy()
  })

  it('reads a chat saved with one interceptor as a list of one', () => {
    setup(() => [])
    ;(session as unknown as { restoreInterceptor: (m: ChatMetadata) => void }).restoreInterceptor({
      interceptorScript: 'Sample guard',
      interceptorChecks: 'both',
    } as ChatMetadata)
    expect(session.interceptor.entries.value).toMatchObject([
      { script: 'Sample guard', checks: 'both', enabled: true },
    ])
  })
})
