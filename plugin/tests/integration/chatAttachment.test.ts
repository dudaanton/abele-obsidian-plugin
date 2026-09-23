/**
 * One agent chat attached to another.
 *
 * The attached chat's file holds everything its own agent was shown: every note it read, every
 * result its tools returned, its reasoning, the conversation it compacted away. The agent it is
 * attached to may have access to none of that. So what crosses over is the conversation — what
 * the person and the other agent wrote — and each test below plants a secret in one of the
 * places a chat log keeps things and checks that it does not cross, by whichever road: an
 * attachment on a message, the `read` tool, a content search, the scope.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { serializeChat } from '@/ai/ChatLog'
import { chatForAgent } from '@/ai/chatText'
import { resolveAttachmentsForApi } from '@/ai/attachments'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { createFindTool } from '@/ai/tools/FindTool'
import { DEFAULT_AI_SETTINGS, type AiProvider, type ChatMessage } from '@/ai/types'
import type { Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const CHAT = 'AI/Chats/Trip planning.abchat'
const NOTE = 'Private/Diary.md'

/** One secret per place a chat log keeps something the other agent was shown. */
const S = {
  noteRead: 'SECRET-NOTE-BODY',
  toolArgs: 'SECRET-TOOL-ARGUMENT',
  toolError: 'SECRET-TOOL-ERROR',
  thinking: 'SECRET-REASONING',
  internalCall: 'SECRET-INTERNAL-CALL',
  internalThinking: 'SECRET-INTERNAL-THINKING',
  internalResult: 'SECRET-INTERNAL-RESULT',
  attachedNote: 'SECRET-ATTACHED-NOTE',
  compacted: 'SECRET-COMPACTION',
  abandonedBranch: 'SECRET-ABANDONED-BRANCH',
  draft: 'SECRET-UNSENT-DRAFT',
  sideChat: 'SECRET-INTERCEPTOR',
  run: 'SECRET-RUN',
  anchor: 'SECRET-ANCHOR-QUOTE',
  recap: 'SECRET-RECAP',
  touched: 'SECRET-TOUCHED-PATH',
  prompt: 'SECRET-SYSTEM-PROMPT',
  diff: 'SECRET-DIFF',
  structured: 'SECRET-STRUCTURED-PART',
}
const SECRETS = Object.values(S)

const expectNoSecret = (text: string) => {
  for (const secret of SECRETS) expect(text).not.toContain(secret)
}

function attachedChat(): string {
  const messages: ChatMessage[] = [
    {
      id: 'u1',
      role: 'user',
      content: 'Plan a weekend in Lisbon using my diary.',
      attachments: [`Private/${S.attachedNote}.md`],
      timestamp: 1,
    },
    {
      id: 'c1',
      parentId: 'u1',
      role: 'tool-call',
      content: 'Calling read',
      toolName: 'read',
      toolParams: { path: NOTE, note: S.toolArgs },
      toolResult: S.noteRead,
      toolDiff: { old: S.diff, new: S.diff },
      toolStatus: 'approved',
      timestamp: 2,
    },
    {
      id: 'e1',
      parentId: 'c1',
      role: 'tool-result',
      content: S.toolError,
      toolName: 'fetch',
      toolStatus: 'rejected',
      timestamp: 3,
    },
    {
      id: 'a-old',
      parentId: 'e1',
      role: 'assistant',
      content: `Old answer ${S.abandonedBranch}`,
      timestamp: 4,
    },
    {
      id: 'a1',
      parentId: 'e1',
      role: 'assistant',
      content: 'Friday: Alfama. Saturday: Belém. Sunday: Sintra.',
      thinking: S.thinking,
      subAgentRun: {
        runId: S.run,
        agentId: 'x',
        agentName: S.run,
        path: S.run,
        status: 'done',
        branchCount: 1,
      },
      timestamp: 5,
    },
    {
      id: 'sys',
      parentId: 'a1',
      role: 'system',
      content: `[Conversation compacted] ${S.compacted}`,
      timestamp: 6,
    },
    {
      id: 'd1',
      parentId: 'sys',
      role: 'user',
      content: S.draft,
      draft: true,
      interceptorChat: [{ id: 'i', role: 'assistant', content: S.sideChat, timestamp: 7 }],
      timestamp: 7,
    },
    {
      id: 'u2',
      parentId: 'sys',
      role: 'user',
      content: 'Swap Sintra for Cascais.',
      interceptorName: 'Checker',
      interceptorChat: [{ id: 'i2', role: 'assistant', content: S.sideChat, timestamp: 8 }],
      timestamp: 8,
    },
    {
      id: 'a2',
      parentId: 'u2',
      role: 'assistant',
      content: 'Done: Sunday is Cascais.',
      timestamp: 9,
    },
    // A message shaped the way the provider shapes one, with its parts — never plain text.
    {
      id: 's1',
      parentId: 'a2',
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 't', name: 'read', arguments: { path: S.structured } },
      ] as unknown as string,
      timestamp: 10,
    },
  ]

  const internal = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Plan a weekend in Lisbon using my diary.' },
        { type: 'text', text: `--- diary.md ---\n${S.attachedNote}` },
      ],
      timestamp: 1,
      chatMessageId: 'u1',
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: S.internalThinking },
        { type: 'toolCall', id: 't1', name: 'read', arguments: { path: S.internalCall } },
      ],
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'read',
      content: [{ type: 'text', text: S.internalResult }],
      isError: false,
      timestamp: 3,
    },
    { role: 'system', content: S.prompt, timestamp: 4 },
  ] as unknown as Message[]

  return serializeChat({
    metadata: {
      type: 'abele-chat',
      kind: 'chat',
      anchor: { note: NOTE, quote: S.anchor },
      touched: [{ path: S.touched, at: '2026-09-01T00:00:00Z' }],
      recap: S.recap,
      providerId: 'p',
      modelId: 'm',
      created: '2026-09-01',
      title: 'Trip planning',
      activeLeafId: 's1',
      customSystemPrompt: S.prompt,
    },
    messages,
    internalMessages: internal,
  })
}

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

beforeEach(() => {
  vi.restoreAllMocks()
  useVault([
    { path: CHAT, content: attachedChat() },
    { path: NOTE, content: S.noteRead },
    { path: 'Notes/Plain.md', content: 'plain' },
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [provider] }
  ScopeResolver.getInstance().clear()
})

describe('what an attached chat gives the agent', () => {
  it('is the conversation on the active branch, in order', () => {
    const text = chatForAgent(attachedChat(), 'Trip planning')

    const order = [
      'Plan a weekend in Lisbon using my diary.',
      'Friday: Alfama. Saturday: Belém. Sunday: Sintra.',
      'Swap Sintra for Cascais.',
      'Done: Sunday is Cascais.',
    ].map((line) => text.indexOf(line))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text).toContain('Trip planning')
  })

  it('carries nothing the other agent was shown, nor anything around the conversation', () => {
    expectNoSecret(chatForAgent(attachedChat(), 'Trip planning'))
  })

  it('keeps the end of a conversation too long to send whole, and says the start was cut', () => {
    const long: ChatMessage[] = Array.from({ length: 400 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? 'assistant' : 'user',
      content: `message ${i} ${'x'.repeat(500)}`,
      timestamp: i,
    }))
    const text = chatForAgent(
      serializeChat({
        metadata: { type: 'abele-chat', providerId: 'p', modelId: 'm', created: '', title: 'Long' },
        messages: long,
        internalMessages: [],
      }),
      'Long'
    )
    expect(text.length).toBeLessThan(110 * 1024)
    expect(text).toContain('message 399 ')
    expect(text).not.toContain('message 0 ')
    expect(text).toContain('earlier messages omitted')
  })

  it('is refused for a file that is not a chat', () => {
    expect(chatForAgent('{"hello": "world"}', 'x')).toBe('[Not a chat: x]')
  })
})

describe('a chat attached to a message', () => {
  it('reaches the model as the conversation, not as the file', async () => {
    const parts = await resolveAttachmentsForApi([CHAT])

    expect(parts).toHaveLength(1)
    const text = (parts[0] as { text: string }).text
    expect(text).toContain('Swap Sintra for Cascais.')
    expectNoSecret(text)
  })

  it('is sent that way by a chat, and leaves the chat’s scope as it was', async () => {
    const registry = AgentRegistry.getInstance()
    registry.setDefault(registry.create({ name: 'D', providerId: 'p1', modelId: 'big' }).id)
    const session = new ChatSession(ChatService.getInstance())
    vi.spyOn(session, 'save').mockResolvedValue(undefined)
    vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
    const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
      .summarizer
    for (const task of ['generateTitle', 'generateSummary', 'autoCompactIfNeeded']) {
      vi.spyOn(summarizer, task).mockResolvedValue(undefined)
    }

    let sent: Message[] = []
    vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
      sent = [...opts.messages]
      return { messages: sent }
    })

    await session.sendMessage('What did we decide?', [CHAT])

    const payload = JSON.stringify(sent)
    expect(payload).toContain('Done: Sunday is Cascais.')
    expectNoSecret(payload)
    expect(session.scopeResolver.isInScope(CHAT)).toBe(false)
    expect(session.scopeResolver.isInScope(NOTE)).toBe(false)
  })
})

describe('a chat log reached through the tools', () => {
  it('is never in a scope — not by folder, pattern or file entry', () => {
    const scope = ScopeResolver.getInstance()
    scope.addFolder('AI/Chats')
    scope.addPattern('**/*.abchat')
    scope.addFile(CHAT)

    expect(scope.isInScope(CHAT)).toBe(false)
    expect(scope.getAccessiblePaths()).not.toContain(CHAT)
  })

  it('is refused to `read` under a scope that names it', async () => {
    ScopeResolver.getInstance().addFile(CHAT)
    await expect(createReadFileTool().execute('r', { path: CHAT })).rejects.toThrow(/Access denied/)
  })

  it('reads as the conversation alone when the whole vault is open', async () => {
    ScopeResolver.getInstance().setFullVaultAccess(true)
    const result = await createReadFileTool().execute('r', { path: CHAT })
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('')

    expect(text).toContain('Done: Sunday is Cascais.')
    expectNoSecret(text)
  })

  it('cannot be searched for what its tools returned', async () => {
    ScopeResolver.getInstance().setFullVaultAccess(true)
    const find = createFindTool()
    const run = async (value: string) => {
      const result = await find.execute('f', {
        criteria: [{ type: 'content', operator: 'contains', value }],
      })
      return result.content.map((c) => ('text' in c ? c.text : '')).join('')
    }

    expect(await run(S.internalResult)).not.toContain(CHAT)
    expect(await run('Cascais')).toContain(CHAT)
  })
})
