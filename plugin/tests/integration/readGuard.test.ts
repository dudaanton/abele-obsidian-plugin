/**
 * An agent may only change a file it has seen as it is now.
 *
 * Driven through the chat the way a model drives it: a fake model client asks for tool calls,
 * the real loop runs them through the session's own tools, and what comes back is what the
 * model would be told. A call refused here must change nothing, and its message must start with
 * the words the agent is told to look for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { READ_FIRST } from '@/ai/readGuard'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message, ModelConfig, ToolCallContent, ToolResultMessage } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

/** Each model turn in order: the tool calls it asks for, or the words it ends with. */
let script: Array<ToolCallContent[] | string> = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, _system: string, _messages: Message[]) {
      const next = script.shift() ?? 'done'
      const content = typeof next === 'string' ? [{ type: 'text' as const, text: next }] : next
      yield {
        type: 'done' as const,
        message: {
          role: 'assistant' as const,
          content,
          model: 'm1',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: typeof next === 'string' ? ('stop' as const) : ('toolUse' as const),
          timestamp: Date.now(),
        },
      }
    }
  }
  return { OpenAIClient }
})

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'm1', name: 'M1', contextWindow: 100000, maxTokens: 100, supportsReasoning: false },
  ],
}

const A = 'Notes/A.md'
const B = 'Notes/B.md'
const LONG = 'Notes/Long.md'

let app: FakeApp
let callId = 0

type Call = [name: string, args: Record<string, unknown>]

const call = ([name, args]: Call): ToolCallContent => ({
  type: 'toolCall',
  id: `c${++callId}`,
  name,
  arguments: args,
})

const internal = (session: ChatSession): Message[] =>
  (session as unknown as { allInternalMessages: Message[] }).allInternalMessages

/**
 * One turn of the agent making these calls, in order, in one go — so a read and the edit after
 * it share a turn, as they usually do. Returns what each call answered.
 */
async function agentDoes(session: ChatSession, ...calls: Call[]): Promise<ToolResultMessage[]> {
  const asked = calls.map(call)
  script = [asked, 'done']
  await session.sendMessage('go')
  return asked.map((tc) => {
    const result = internal(session).find(
      (m): m is ToolResultMessage => m.role === 'toolResult' && m.toolCallId === tc.id
    )
    if (!result) throw new Error(`no result for ${tc.name}`)
    return result
  })
}

const text = (r: ToolResultMessage) => r.content.map((c) => c.text).join('')
const content = (path: string) => app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)

function newSession(kind: 'chat' | 'run' = 'chat'): ChatSession {
  const session = new ChatSession(ChatService.getInstance(), undefined, { kind })
  session.scopeResolver.entries.value = [{ type: 'folder', path: 'Notes' }]
  session.permissionMode.value = 'allow-all'
  // `write` is not handed out by default.
  session.toolModes.value = { write: 'auto' }
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'generateSummary').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  return session
}

beforeEach(() => {
  callId = 0
  app = useVault([
    { path: A, content: 'alpha\nsecond line\n' },
    { path: B, content: 'beta\n' },
    { path: LONG, content: 'one\ntwo\nthree\nfour\n' },
  ])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'D', providerId: 'p1', modelId: 'm1' }).id)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const editA: Call = ['edit', { path: A, old_string: 'alpha', new_string: 'ALPHA' }]

describe('a file the agent has not read', () => {
  it('cannot be edited, and is left as it was', async () => {
    const [edit] = await agentDoes(newSession(), editA)

    expect(edit.isError).toBe(true)
    expect(text(edit).startsWith(READ_FIRST)).toBe(true)
    expect(text(edit)).toContain('has not been read')
    expect(await content(A)).toBe('alpha\nsecond line\n')
  })

  it('cannot be overwritten', async () => {
    const [write] = await agentDoes(newSession(), ['write', { path: A, content: 'gone' }])

    expect(text(write).startsWith(READ_FIRST)).toBe(true)
    expect(await content(A)).toBe('alpha\nsecond line\n')
  })

  it('cannot be changed by replace either', async () => {
    const [replace] = await agentDoes(newSession(), [
      'replace',
      { path: A, actions: [{ type: 'replace-in-content', old_value: 'alpha', value: 'x' }] },
    ])

    expect(text(replace).startsWith(READ_FIRST)).toBe(true)
    expect(await content(A)).toBe('alpha\nsecond line\n')
  })

  it('is refused before anyone is asked to approve the call', async () => {
    const session = newSession()
    session.permissionMode.value = 'confirm-all'

    const [edit] = await agentDoes(session, editA)

    expect(session.pendingToolCalls.value).toEqual([])
    expect(text(edit).startsWith(READ_FIRST)).toBe(true)
  })

  it('does not stop a new file being created', async () => {
    const [create] = await agentDoes(newSession(), [
      'create',
      { path: 'Notes/New.md', content: 'fresh' },
    ])

    expect(create.isError).toBe(false)
    expect(await content('Notes/New.md')).toBe('fresh')
  })
})

describe('a file the agent has read', () => {
  it('can be edited in the same turn', async () => {
    const [, edit] = await agentDoes(newSession(), ['read', { path: A }], editA)

    expect(edit.isError).toBe(false)
    expect(await content(A)).toBe('ALPHA\nsecond line\n')
  })

  it('can be edited in a later turn', async () => {
    const session = newSession()
    await agentDoes(session, ['read', { path: A }])
    const [edit] = await agentDoes(session, editA)

    expect(edit.isError).toBe(false)
  })

  it('is refused once it has changed outside the chat, until it is read again', async () => {
    const session = newSession()
    await agentDoes(session, ['read', { path: A }])
    await app.vault.modify(app.vault.getAbstractFileByPath(A) as TFile, 'alpha, edited by hand\n')

    const [refused] = await agentDoes(session, editA)
    expect(text(refused).startsWith(READ_FIRST)).toBe(true)
    expect(text(refused)).toMatch(/has changed since you read it at \d\d:\d\d:\d\d/)
    expect(await content(A)).toBe('alpha, edited by hand\n')

    const [, edit] = await agentDoes(session, ['read', { path: A }], editA)
    expect(edit.isError).toBe(false)
    expect(await content(A)).toBe('ALPHA, edited by hand\n')
  })

  it('stays known after the agent writes it itself', async () => {
    const results = await agentDoes(
      newSession(),
      ['read', { path: A }],
      ['write', { path: A, content: 'alpha rewritten\n' }],
      editA,
      ['edit', { path: A, old_string: 'rewritten', new_string: 'again' }]
    )

    expect(results.map((r) => r.isError)).toEqual([false, false, false, false])
    expect(await content(A)).toBe('ALPHA again\n')
  })

  it('stays known after the agent creates it', async () => {
    const [, edit] = await agentDoes(
      newSession(),
      ['create', { path: 'Notes/New.md', content: 'fresh' }],
      ['edit', { path: 'Notes/New.md', old_string: 'fresh', new_string: 'stale' }]
    )

    expect(edit.isError).toBe(false)
  })

  it('is known at its new path after a move', async () => {
    const [, , edit] = await agentDoes(
      newSession(),
      ['read', { path: A }],
      ['mv', { from: A, to: 'Notes/Moved.md' }],
      ['edit', { path: 'Notes/Moved.md', old_string: 'alpha', new_string: 'ALPHA' }]
    )

    expect(edit.isError).toBe(false)
  })

  it('counts when it was attached to a message', async () => {
    const session = newSession()
    script = ['done']
    await session.sendMessage('look at this', [A])

    const [edit] = await agentDoes(session, editA)
    expect(edit.isError).toBe(false)
  })
})

describe('a window of lines', () => {
  const window: Call = ['read', { path: LONG, start_line: 2, end_line: 3 }]

  it('is enough to edit', async () => {
    const [, edit] = await agentDoes(newSession(), window, [
      'edit',
      { path: LONG, old_string: 'two', new_string: 'TWO' },
    ])

    expect(edit.isError).toBe(false)
  })

  it('is not enough to overwrite the whole file', async () => {
    const [, write] = await agentDoes(newSession(), window, [
      'write',
      { path: LONG, content: 'all new' },
    ])

    expect(text(write).startsWith(READ_FIRST)).toBe(true)
    expect(text(write)).toContain('only lines 2–3')
    expect(await content(LONG)).toBe('one\ntwo\nthree\nfour\n')
  })

  it('does not undo a whole read of the same text', async () => {
    const [, , write] = await agentDoes(newSession(), ['read', { path: LONG }], window, [
      'write',
      { path: LONG, content: 'all new' },
    ])

    expect(write.isError).toBe(false)
  })
})

describe('what the chat has seen, over its life', () => {
  it('survives closing and reopening the chat', async () => {
    const session = newSession()
    await agentDoes(session, ['read', { path: A }])
    await session.save()
    const file = session.currentChatFile.value as TFile

    const reopened = newSession()
    await reopened.load(file)
    reopened.scopeResolver.entries.value = [{ type: 'folder', path: 'Notes' }]
    reopened.permissionMode.value = 'allow-all'
    reopened.toolModes.value = { write: 'auto' }

    const [edit] = await agentDoes(reopened, editA)
    expect(edit.isError).toBe(false)
  })

  it('is forgotten when the chat is compacted', async () => {
    const session = newSession()
    await agentDoes(session, ['read', { path: A }])
    session.applyCompactSummary('We looked at A.')

    const [edit] = await agentDoes(session, editA)
    expect(text(edit).startsWith(READ_FIRST)).toBe(true)
  })

  it('goes with the branch it was read on', async () => {
    const session = newSession()
    script = ['hello']
    await session.sendMessage('first')
    const beforeRead = session.messages.value[session.messages.value.length - 1].id
    await agentDoes(session, ['read', { path: A }])

    session.createBranch(beforeRead)
    const [edit] = await agentDoes(session, editA)
    expect(text(edit).startsWith(READ_FIRST)).toBe(true)
  })
})

describe('a sub-agent', () => {
  it('has seen nothing its parent read, and its writes are news to the parent', async () => {
    const parent = newSession()
    await agentDoes(parent, ['read', { path: A }])

    const run = newSession('run')
    const [refused] = await agentDoes(run, editA)
    expect(text(refused).startsWith(READ_FIRST)).toBe(true)

    const [, edit] = await agentDoes(run, ['read', { path: A }], editA)
    expect(edit.isError).toBe(false)

    const [stale] = await agentDoes(parent, [
      'edit',
      { path: A, old_string: 'second', new_string: '2nd' },
    ])
    expect(text(stale)).toContain('has changed since you read it')
  })
})

describe('a script', () => {
  it('calls the tools directly and is never refused', async () => {
    const result = await createEditFileTool({ skipScope: true }).execute('s1', {
      path: A,
      old_string: 'alpha',
      new_string: 'ALPHA',
    })

    expect(text(result as unknown as ToolResultMessage)).toBe(`Edited: ${A}`)
  })
})
