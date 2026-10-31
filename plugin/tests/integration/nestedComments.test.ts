/**
 * "Ask here" inside a comment on a chat, and inside a comment on that, to any depth.
 *
 * A comment on a message of a chat is a chat of its own, and its messages are messages like any
 * other: the person selects words in one and asks about them. The new comment hangs on the
 * comment the way the first hung on the chat — its place in the parent's `comments`, the
 * parent's file as its `anchor.note` — so the machinery is the same at every level. What is
 * guarded: both ends are written at every depth, the parent stays alive behind its child, the
 * way back leads up one level at a time, the child is told the chain above it without being
 * handed the conversations, and deleting anything takes everything below it along.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { ChatSession } from '@/ai/ChatSession'
import { NodeScopeLedger } from '@/ai/nodeScope'
import { parseChatMetadata, serializeChat, serializeMetadata } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type ChatMetadata } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const CHAT = 'AI/Chats/Riga trip.abchat'
const C1 = 'first1'
const C2 = 'second'
const path = (id: string) => `AI/Comments/${id}.abchat`

const message = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  parentId?: string
): ChatMessage => ({ id, role, content, timestamp: 1, ...(parentId ? { parentId } : {}) })

const meta = (extra: Partial<ChatMetadata>): ChatMetadata => ({
  type: 'abele-chat',
  providerId: 'p',
  modelId: 'm',
  created: '2026-09-25',
  ...extra,
})

/**
 * A chat, a comment on its answer, and a comment on that comment's answer — the tree two
 * levels deep, written the way the plugin writes it.
 */
function tree() {
  return [
    {
      path: CHAT,
      content: serializeChat({
        metadata: meta({
          title: 'Riga trip',
          comments: [{ id: C1, message: 'a1', quote: 'night train', start: 9 }],
        }),
        messages: [
          message('u1', 'user', 'How do I get to Riga?'),
          message('a1', 'assistant', 'Take the night train from Vilnius.', 'u1'),
        ],
        internalMessages: [],
      }),
    },
    {
      path: path(C1),
      content: serializeChat({
        metadata: meta({
          kind: 'comment',
          anchor: { note: CHAT, quote: 'night train', message: 'a1' },
          comments: [{ id: C2, message: 'c1a', quote: 'Baltic Express', start: 4 }],
        }),
        messages: [
          message('c1u', 'user', 'Which train exactly?'),
          message('c1a', 'assistant', 'The Baltic Express, it leaves at 21:40.', 'c1u'),
        ],
        internalMessages: [],
      }),
    },
    {
      path: path(C2),
      content: serializeChat({
        metadata: meta({
          kind: 'comment',
          anchor: { note: path(C1), quote: 'Baltic Express', message: 'c1a' },
        }),
        messages: [
          message('c2u', 'user', 'Does it have sleeping cars?'),
          message('c2a', 'assistant', 'Yes, two classes of couchette.', 'c2u'),
        ],
        internalMessages: [],
      }),
    },
  ]
}

let app: FakeApp

const file = (p: string) => app.vault.getAbstractFileByPath(p) as TFile | null
const metadataOf = async (p: string) =>
  parseChatMetadata((await app.vault.read(file(p)!)) as string)

/** A comment as a marker press brings it up: in the sidebar tab, and the session behind it. */
async function show(id: string) {
  const service = CommentService.getInstance()
  expect(await service.showInSidebar(id)).toBe(true)
  return service.sessionFor(id)!
}

beforeEach(() => {
  app = useVault(tree())
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats',
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Default' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'sidebarShowing').mockReturnValue(true)
})

describe('nested node access', () => {
  const scope = [{ kind: 'node' as const, node_id: 'sample-node', access: 'edit' as const }]

  it('copies live parent scope on creation and preserves later child changes', async () => {
    const service = CommentService.getInstance()
    const parent = await show(C1)
    parent.overrides.value = { nodeScope: scope }
    const child = (await service.createOnMessage(parent, 'c1a'))!
    expect(child.overrides.value.nodeScope).toEqual(scope)
    expect((await metadataOf(path(child.commentId!)))?.overrides?.nodeScope).toEqual(scope)
    child.overrides.value = { nodeScope: [] }
    await child.save()
    expect((await service.load(child.commentId!))!.overrides.value.nodeScope).toEqual([])
  })

  it('inherits through unopened legacy ancestors and preserves explicit empty scope', async () => {
    await app.vault.append(
      file(CHAT)!,
      serializeMetadata(meta({ overrides: { nodeScope: scope } }))
    )
    const child = await show(C2)
    expect(child.overrides.value.nodeScope).toEqual(scope)
    child.overrides.value = { nodeScope: [] }
    await child.save()
    CommentService.getInstance().destroy()
    ChatService.getInstance().destroy()
    expect((await CommentService.getInstance().load(C2))!.overrides.value.nodeScope).toEqual([])
  })

  it('fills an open unscoped child when its parent gains access', async () => {
    const child = await show(C2)
    const parent = await show(C1)
    parent.overrides.value = { nodeScope: scope }
    expect((await CommentService.getInstance().load(C2))!.overrides.value.nodeScope).toEqual(scope)
    expect(child.overrides.value.nodeScope).toEqual(scope)
  })

  it('inherits approved access on direct chat loads, including promoted discussions', async () => {
    const parent = await show(C1)
    parent.overrides.value = { nodeScope: scope }
    await parent.ensureDelegationParentId()
    const ledger = () =>
      new NodeScopeLedger({
        read: () => app.loadLocalStorage('abele-chat-node-scope-approvals'),
        write: (value) => app.saveLocalStorage('abele-chat-node-scope-approvals', value),
      })
    ledger().approve(parent, { 'sample-node': 'sample-installation' })
    await app.vault.append(
      file(path(C2))!,
      serializeMetadata({ ...(await metadataOf(path(C2)))!, kind: 'chat' })
    )
    const child = new ChatSession(ChatService.getInstance())
    try {
      await child.load(file(path(C2))!)
      expect(child.overrides.value.nodeScope).toEqual(scope)
      expect(ledger().approvedNode(child, 'sample-node', 'sample-installation')).toBe(true)
    } finally {
      child.destroy()
    }
  })

  it('does not cross a parent’s explicit empty scope to inherit from a grandparent', async () => {
    await app.vault.append(
      file(CHAT)!,
      serializeMetadata(meta({ overrides: { nodeScope: scope } }))
    )
    await app.vault.append(
      file(path(C1))!,
      serializeMetadata(
        meta({
          kind: 'comment',
          anchor: { note: CHAT, message: 'a1' },
          overrides: { nodeScope: [] },
        })
      )
    )
    expect((await show(C2)).overrides.value.nodeScope).toBeUndefined()
  })

  it('still opens a child when its parent has malformed node scope', async () => {
    await app.vault.append(
      file(CHAT)!,
      serializeMetadata(meta({ overrides: { nodeScope: [{ ...scope[0], node_id: '' }] } }))
    )
    expect((await show(C2)).overrides.value.nodeScope).toBeUndefined()
  })

  it.each([false, true])(
    'keeps child node access through promotion (save fails: %s)',
    async (fails) => {
      const service = CommentService.getInstance()
      const parent = await show(C1)
      parent.bindAgent(AgentRegistry.getInstance().create({ name: 'Sample executor' }).id)
      parent.overrides.value = { nodeScope: scope }
      const child = (await service.createOnMessage(parent, 'c1a'))!
      const own = [{ ...scope[0], node_id: 'another-sample-node' }]
      child.overrides.value = { nodeScope: own }
      await child.save()
      await child.ensureDelegationParentId()
      const owner = await import('@/ai/tools/node/owner')
      const ledger = new NodeScopeLedger()
      const reconcile = vi
        .spyOn(owner, 'reconcileNodeScopeApproval')
        .mockImplementation((session) => ledger.reconcile(session))
      ledger.approve(child, { 'another-sample-node': 'sample-installation' })
      if (fails) {
        vi.spyOn(child, 'saveForRelease').mockRejectedValueOnce(new Error('sample write failure'))
        await expect(service.expand(child.commentId!)).rejects.toThrow('sample write failure')
      } else {
        expect(await service.expand(child.commentId!)).toBe('moved')
      }
      expect(child.overrides.value.nodeScope).toEqual(own)
      expect((await metadataOf(path(child.commentId!)))?.overrides?.nodeScope).toEqual(own)
      expect(ledger.approvedNode(child, 'another-sample-node', 'sample-installation')).toBe(true)
      reconcile.mockRestore()
    }
  )
})

describe('asking inside a comment', () => {
  it('hangs the new one on the comment’s message, and writes it into the comment’s file', async () => {
    const service = CommentService.getInstance()
    const parent = await show(C1)

    const child = (await service.createOnMessage(parent, 'c1a', '21:40', 34))!
    const id = child.commentId!

    expect(parent.messageComments.value.map((c) => c.id)).toEqual([C2, id])
    expect((await metadataOf(path(C1)))?.comments).toContainEqual({
      id,
      message: 'c1a',
      quote: '21:40',
      start: 34,
    })
    const own = await metadataOf(path(id))
    expect(own?.kind).toBe('comment')
    expect(own?.anchor).toEqual({ note: path(C1), quote: '21:40', message: 'c1a' })
    // Answered by the agent that was having the conversation it came out of.
    expect(own?.agentId).toBe(parent.agentId.value)
  })

  it('takes the tab, and leaves the comment it came from alive behind it', async () => {
    const service = CommentService.getInstance()
    const chats = ChatService.getInstance()
    const parent = await show(C1)

    const child = (await service.createOnMessage(parent, 'c1a', '21:40', 34))!

    expect(chats.activeSession.value).toBe(child)
    expect(service.isShown(child.commentId!)).toBe(true)
    // A nested comment never closes its parent: the parent stays shown and keeps its tab.
    expect(service.isShown(C1)).toBe(true)
    expect(chats.tabOrder.value).toContain(parent.id)
    // Still alive: it paints its message's marker and stays reachable.
    expect(parent.isDestroyed).toBe(false)
    expect(service.sessionFor(C1)).toBe(parent)
  })

  it('goes on to any depth, each level in the file of the one above', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)

    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!
    // On the whole of a message, as "Ask here" with nothing selected makes one.
    const fourth = await service.createOnMessage(third, 'some-later-message')
    expect(fourth).not.toBeNull()

    expect((await metadataOf(path(C2)))?.comments?.map((c) => c.id)).toEqual([third.commentId])
    expect((await metadataOf(path(third.commentId!)))?.comments?.map((c) => c.id)).toEqual([
      fourth!.commentId,
    ])
    expect(fourth!.anchor.value?.note).toBe(path(third.commentId!))
  })

  it('comes back with its comments when it is read again from its file', async () => {
    const service = CommentService.getInstance()
    const parent = await show(C1)
    const id = (await service.createOnMessage(parent, 'c1a', '21:40', 34))!.commentId!

    CommentService.getInstance().destroy()
    ChatService.getInstance().destroy()
    const again = await CommentService.getInstance().load(C1)

    expect(again!.messageComments.value.map((c) => c.id)).toEqual([C2, id])
  })
})

describe('what a nested comment is told', () => {
  it('the comment it is in, the message and what was said before it there', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)
    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!

    const prompt = await ChatService.getInstance().getTurnContext(third)

    expect(prompt).toContain('Selected text:\ncouchette')
    expect(prompt).toContain('Yes, two classes of couchette.')
    expect(prompt).toContain('Does it have sleeping cars?')
    // Named after the question that opened it, not after its six-letter file name.
    expect(prompt).not.toContain(`Chat: ${C2}`)
  })

  it('the chain above, by its quotes and names only — not the conversations up there', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)
    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!

    const prompt = await ChatService.getInstance().getTurnContext(third)

    expect(prompt).toContain('Baltic Express')
    expect(prompt).toContain('night train')
    expect(prompt).toContain('Riga trip')
    // Two levels up: named, not carried.
    expect(prompt).not.toContain('How do I get to Riga?')
    expect(prompt).not.toContain('it leaves at 21:40')
  })
})

describe('the trail', () => {
  it('runs from the chat at the root down to the comment in front', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)
    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!

    const trail = await service.trail(third)

    expect(trail.map((step) => step.kind)).toEqual(['chat', 'comment', 'comment', 'comment'])
    expect(trail.map((step) => step.title)).toEqual([
      'Riga trip',
      'Which train exactly?',
      'Does it have sleeping cars?',
      'couchette',
    ])
    expect(trail[1].id).toBe(C1)
    expect(trail[2].anchor).toEqual({ note: path(C1), quote: 'Baltic Express', message: 'c1a' })
  })

  it('starts at the note when the first comment was on a note', async () => {
    const service = CommentService.getInstance()
    const note = await app.vault.create('Notes/Trip.md', 'Some words and more.\n')
    const first = await service.create(note as TFile, 'Some words'.length, 'Some words')
    await service.showInSidebar(first.commentId!)

    const trail = await service.trail(first)

    expect(trail.map((step) => [step.kind, step.title])).toEqual([
      ['note', 'Trip'],
      ['comment', 'Some words'],
    ])
  })

  it('says a level above has gone rather than stopping short', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)
    await app.vault.delete(file(path(C1))!)

    const trail = await service.trail(second)

    expect(trail.map((step) => step.kind)).toEqual(['comment', 'comment'])
    expect(trail[0].missing).toBe(true)
  })

  it('stops on a loop rather than walking it for ever', async () => {
    const service = CommentService.getInstance()
    // Written by hand, not by the plugin: C1 claims to hang on C2, which hangs on C1.
    await app.vault.append(
      file(path(C1))!,
      serializeMetadata(meta({ kind: 'comment', anchor: { note: path(C2), message: 'c2a' } }))
    )
    const second = await show(C2)

    const trail = await service.trail(second)

    expect(trail.length).toBeLessThanOrEqual(3)
  })
})

describe('the way back', () => {
  it('can return to a parent without revealing another pane', async () => {
    const { revealAnswer } = await import('@/ai/openChat')
    const chats = ChatService.getInstance()
    const parent = await show(C2)
    const child = (await CommentService.getInstance().createOnMessage(parent, 'c2a', 'sample', 0))!
    vi.mocked(chats.revealSidebar).mockClear()
    expect(await revealAnswer(child.anchor.value!, child.commentId!, false)).toBe(true)
    expect(chats.activeSession.value).toBe(parent)
    expect(chats.pendingReveal.value).toBe('c2a')
    expect(chats.revealSidebar).not.toHaveBeenCalled()
  })

  it('leads up one level: the comment above in the tab, its message brought into view', async () => {
    const { revealAnswer } = await import('@/ai/openChat')
    const service = CommentService.getInstance()
    const chats = ChatService.getInstance()
    const second = await show(C2)
    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!

    expect(await revealAnswer(third.anchor.value!)).toBe(true)

    expect(chats.activeSession.value).toBe(second)
    expect(service.isShown(C2)).toBe(true)
    expect(service.isShown(third.commentId!)).toBe(false)
    expect(chats.pendingReveal.value).toBe('c2a')
  })
})

describe('deleting', () => {
  it('a comment takes every comment below it along, at every depth', async () => {
    const service = CommentService.getInstance()
    const second = await show(C2)
    const third = (await service.createOnMessage(second, 'c2a', 'couchette', 21))!

    await service.remove(C1)

    expect(file(path(C1))).toBeNull()
    expect(file(path(C2))).toBeNull()
    expect(file(path(third.commentId!))).toBeNull()
    expect((await metadataOf(CHAT))?.comments ?? []).toEqual([])
  })

  it('a child is taken off its parent through the parent’s own session, not behind it', async () => {
    const service = CommentService.getInstance()
    const parent = await show(C1)
    const child = (await service.createOnMessage(parent, 'c1a', '21:40', 34))!
    const id = child.commentId!

    await ChatService.getInstance().deleteChat(child.id)

    expect(parent.messageComments.value.map((c) => c.id)).toEqual([C2])
    // Written by the parent's session: a later save of it must not put the child back.
    await parent.save()
    expect((await metadataOf(path(C1)))?.comments?.map((c) => c.id)).toEqual([C2])
    expect(file(path(id))).toBeNull()
  })

  it('the chat at the root takes the whole tree with it', async () => {
    const service = CommentService.getInstance()

    await service.removeCommentsOn(CHAT)

    expect(file(path(C1))).toBeNull()
    expect(file(path(C2))).toBeNull()
  })
})
