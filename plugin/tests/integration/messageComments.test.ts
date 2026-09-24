/**
 * A comment asked about a passage of an agent's answer, from the selection to the file.
 *
 * The chat keeps where its comments are — an answer has no text of ours to put a marker in —
 * and the comment keeps which chat and which answer it is about. What is guarded: both ends are
 * written, they survive the chat being closed and opened again, they are undone together, a
 * chat that goes takes its comments with it, and the comment's agent is told about the passage
 * without being handed the chat itself or anything its tools produced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Notice, TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, EDIT_SELECTION_TOOL, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const CHAT = 'AI/Chats/Riga trip.abchat'

const MESSAGES: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'How do I get to Riga?', timestamp: 1 },
  {
    id: 't1',
    role: 'tool-call',
    content: 'search',
    toolName: 'search',
    toolResult: 'SECRET TOOL OUTPUT',
    parentId: 'u1',
    timestamp: 2,
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Take the night train from Vilnius.',
    parentId: 't1',
    timestamp: 3,
  },
]

const chatFileText = () =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      title: 'Riga trip',
      providerId: 'p',
      modelId: 'm',
      created: '2026-09-24',
    },
    messages: MESSAGES,
    internalMessages: [],
  })

let app: FakeApp
let commentAgent = ''

const file = (path: string) => app.vault.getAbstractFileByPath(path) as TFile | null
const metadataOf = async (path: string) =>
  parseChatMetadata((await app.vault.read(file(path)!)) as string)

async function openParent() {
  const chats = ChatService.getInstance()
  await chats.openChatFile(file(CHAT)!)
  return chats.getSessionByFile(CHAT)!
}

beforeEach(() => {
  app = useVault([
    { path: CHAT, content: chatFileText() },
    { path: 'Notes/A.md', content: 'Before. The passage After.\n' },
  ])
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
  commentAgent = registry.create({ name: 'Comment', utility: true }).id
  AbeleConfig.getInstance().ai.commentAgentId = commentAgent
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'sidebarShowing').mockReturnValue(true)
})

describe('asking about a passage of an answer', () => {
  it('writes where it is into the chat, and which answer into the comment', async () => {
    const parent = await openParent()
    const service = CommentService.getInstance()

    const comment = await service.createOnMessage(parent, 'a1', 'night train', 9)

    const id = comment!.commentId!
    expect(parent.messageComments.value).toEqual([
      { id, message: 'a1', quote: 'night train', start: 9 },
    ])
    expect((await metadataOf(CHAT))?.comments).toEqual([
      { id, message: 'a1', quote: 'night train', start: 9 },
    ])
    const own = await metadataOf(service.commentPath(id))
    expect(own?.kind).toBe('comment')
    expect(own?.anchor).toEqual({ note: CHAT, quote: 'night train', message: 'a1' })
    // The chat's own agent answers: the comment is a side question in that conversation.
    expect(own?.agentId).toBe(parent.agentId.value)
    expect(own?.agentId).not.toBe(commentAgent)
  })

  it('runs on the chat’s agent and that agent’s scope', async () => {
    const registry = AgentRegistry.getInstance()
    const planner = registry.create({
      name: 'Planner',
      scope: [{ type: 'file', path: 'Notes/A.md' }],
    } as never)
    const parent = await openParent()
    parent.bindAgent(planner.id)

    const comment = (await CommentService.getInstance().createOnMessage(parent, 'a1', 'night', 9))!

    expect(comment.agentId.value).toBe(planner.id)
    expect(comment.scopeResolver.isInScope('Notes/A.md')).toBe(true)
    expect(comment.scopeResolver.isInScope(CHAT)).toBe(false)
  })

  it('can be asked on the person’s own message, told the conversation up to it', async () => {
    const parent = await openParent()

    const comment = (await CommentService.getInstance().createOnMessage(parent, 'u1', 'Riga', 17))!
    const prompt = await ChatService.getInstance().getSystemPrompt(comment)

    expect(comment.anchor.value).toEqual({ note: CHAT, quote: 'Riga', message: 'u1' })
    expect(prompt).toContain('How do I get to Riga?')
    expect(prompt).not.toContain('Take the night train from Vilnius.')
  })

  it('opens at once, in front, as a note comment does', async () => {
    const parent = await openParent()

    const comment = await CommentService.getInstance().createOnMessage(parent, 'a1', 'night', 9)

    expect(ChatService.getInstance().activeSession.value).toBe(comment)
    expect(CommentService.getInstance().isShown(comment!.commentId!)).toBe(true)
  })

  it('can be about the whole answer', async () => {
    const parent = await openParent()

    const comment = await CommentService.getInstance().createOnMessage(parent, 'a1')

    expect(parent.messageComments.value).toEqual([{ id: comment!.commentId!, message: 'a1' }])
  })

  it('is refused on a chat that has not been saved, which has nowhere to keep it', async () => {
    const chats = ChatService.getInstance()
    chats.createTab()
    const blank = chats.activeSession.value!
    Notice.shown.length = 0

    expect(await CommentService.getInstance().createOnMessage(blank, 'a1', 'x', 0)).toBeNull()
    expect(Notice.shown.join(' ')).toContain('not saved yet')
  })

  it('does not get the chat into its scope, nor the tool that rewrites a note', async () => {
    const parent = await openParent()

    const comment = (await CommentService.getInstance().createOnMessage(parent, 'a1', 'night', 9))!

    expect(comment.scopeResolver.isInScope(CHAT)).toBe(false)
    expect(comment.toolDefs().map((t) => t.name)).not.toContain(EDIT_SELECTION_TOOL)
  })

  it('tells its agent the passage and the words around it, and nothing a tool returned', async () => {
    const parent = await openParent()
    const comment = (await CommentService.getInstance().createOnMessage(parent, 'a1', 'night', 9))!

    const prompt = await ChatService.getInstance().getSystemPrompt(comment)

    expect(prompt).toContain('Selected text:\nnight')
    expect(prompt).toContain('Take the night train from Vilnius.')
    expect(prompt).toContain('How do I get to Riga?')
    expect(prompt).not.toContain('SECRET TOOL OUTPUT')
  })
})

describe('after the chat is closed', () => {
  it('comes back with the chat when it is opened again', async () => {
    const chats = ChatService.getInstance()
    const parent = await openParent()
    const comment = (await CommentService.getInstance().createOnMessage(parent, 'a1', 'night', 9))!
    await chats.closeTab(parent.id)

    const again = await openParent()

    expect(again).not.toBe(parent)
    expect(again.messageComments.value.map((c) => c.id)).toEqual([comment.commentId])
  })

  it('is deleted from the chat’s list even when nothing has the chat open', async () => {
    const chats = ChatService.getInstance()
    const service = CommentService.getInstance()
    const parent = await openParent()
    const id = (await service.createOnMessage(parent, 'a1', 'night', 9))!.commentId!
    await chats.closeTab(parent.id)

    await service.remove(id)

    expect((await metadataOf(CHAT))?.comments ?? []).toEqual([])
    expect(file(service.commentPath(id))).toBeNull()
  })
})

describe('deleting', () => {
  it('a comment takes it off the open chat, and its tab away', async () => {
    const service = CommentService.getInstance()
    const parent = await openParent()
    const comment = (await service.createOnMessage(parent, 'a1', 'night', 9))!
    const id = comment.commentId!

    // From the comment's own tab, which is where "Delete" is.
    await ChatService.getInstance().deleteChat(comment.id)

    expect(parent.messageComments.value).toEqual([])
    expect(file(service.commentPath(id))).toBeNull()
    expect(ChatService.getInstance().tabOrder.value).not.toContain(comment.id)
  })

  it('a note comment from its tab takes its marker out of the note too', async () => {
    const service = CommentService.getInstance()
    const note = file('Notes/A.md')!
    const comment = await service.create(note, 'Before. The passage'.length, 'The passage')
    await service.showInSidebar(comment.commentId!)

    await ChatService.getInstance().deleteChat(comment.id)

    expect(await app.vault.read(note)).toBe('Before. The passage After.\n')
  })

  it('the chat takes its comments with it', async () => {
    const service = CommentService.getInstance()
    const chats = ChatService.getInstance()
    const parent = await openParent()
    const id = (await service.createOnMessage(parent, 'a1', 'night', 9))!.commentId!
    chats.switchTab(parent.id)

    await chats.deleteChat(parent.id)

    expect(file(CHAT)).toBeNull()
    expect(file(service.commentPath(id))).toBeNull()
  })

  it('the chat from the history takes its comments with it too', async () => {
    const service = CommentService.getInstance()
    const chats = ChatService.getInstance()
    const parent = await openParent()
    const id = (await service.createOnMessage(parent, 'a1', 'night', 9))!.commentId!
    await chats.closeTab(parent.id)

    await service.removeCommentsOn(CHAT)
    await ChatStorage.getInstance().deleteChat(CHAT)

    expect(file(service.commentPath(id))).toBeNull()
  })
})

describe('the chat renamed', () => {
  it('is followed by the comment', async () => {
    const service = CommentService.getInstance()
    const parent = await openParent()
    const comment = (await service.createOnMessage(parent, 'a1', 'night', 9))!

    await service.handleRename(CHAT, 'AI/Chats/Trip to Riga.abchat')

    expect(comment.anchor.value?.note).toBe('AI/Chats/Trip to Riga.abchat')
  })
})

describe('back to the passage', () => {
  it('opens the chat and asks for the answer to be brought into view', async () => {
    const { revealAnswer } = await import('@/ai/openChat')
    const service = CommentService.getInstance()
    const chats = ChatService.getInstance()
    const parent = await openParent()
    const comment = (await service.createOnMessage(parent, 'a1', 'night', 9))!
    expect(chats.activeSession.value).toBe(comment)

    expect(await revealAnswer(comment.anchor.value!)).toBe(true)

    expect(chats.activeSession.value).toBe(parent)
    expect(chats.pendingReveal.value).toBe('a1')
  })

  it('says so when the chat has been deleted', async () => {
    const { revealAnswer } = await import('@/ai/openChat')
    Notice.shown.length = 0

    expect(await revealAnswer({ note: 'AI/Chats/Gone.abchat', message: 'a1' })).toBe(false)
    expect(Notice.shown.join(' ')).toContain('deleted')
  })
})
