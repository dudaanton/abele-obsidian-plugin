/**
 * Deleting the chat somebody is looking at.
 *
 * The file, its delegated runs and its entry in the index all go — `ChatStorage.deleteChat` has
 * done that much since the history list grew a bin. What is new here is the tab: the session
 * holding that file has to stop existing *before* the file does, or the next thing it saves
 * writes the conversation straight back. And an expanded comment leaves through its own door,
 * because a marker in a note pointing at a file nobody deleted the marker for is a comment that
 * can never be opened again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE = 'Notes/A.md'
const QUOTE = 'The selected passage'

let app: FakeApp

beforeEach(() => {
  app = useVault([{ path: NOTE, content: `${QUOTE} and more.` }])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Default' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})

/** A tab with a conversation in it, saved to a file the way an ordinary chat is. */
async function savedChat() {
  const chats = ChatService.getInstance()
  const id = chats.createTab()
  const session = chats.getSession(id)!
  ;(session as unknown as { allChatMessages: unknown[] }).allChatMessages = [
    { id: 'm1', role: 'user', content: 'tidy this', timestamp: 1 },
  ]
  await session.save()
  return { chats, id, session, path: session.currentChatFile.value!.path }
}

const noteFile = () => app.vault.getAbstractFileByPath(NOTE) as TFile

describe('deleting the chat a tab is holding', () => {
  it('takes the file off disk', async () => {
    const { chats, id, path } = await savedChat()

    expect(await chats.deleteChat(id)).toBe(true)

    expect(app.vault.getAbstractFileByPath(path)).toBeNull()
  })

  it('takes it out of the index a footer and the history read', async () => {
    const { chats, id, path } = await savedChat()
    expect(
      ChatStorage.getInstance()
        .getHistory()
        .some((e) => e.path === path)
    ).toBe(true)

    await chats.deleteChat(id)

    expect(
      ChatStorage.getInstance()
        .getHistory()
        .some((e) => e.path === path)
    ).toBe(false)
  })

  it('closes the tab and ends the conversation in it', async () => {
    const { chats, id, session } = await savedChat()

    await chats.deleteChat(id)

    expect(chats.getSession(id)).toBeNull()
    expect(session.isDestroyed).toBe(true)
  })

  /**
   * The order that matters: a session saves on a timer and at the end of a turn, so one left
   * alive over a deleted path writes the whole conversation back a moment later.
   */
  it('leaves nothing behind that could write the file again', async () => {
    const { chats, id, session, path } = await savedChat()

    await chats.deleteChat(id)
    await session.save()

    expect(app.vault.getAbstractFileByPath(path)).toBeNull()
  })

  /** The sidebar always has a tab: an empty bar is a view showing nothing at all. */
  it('leaves a fresh tab behind when it was the only one', async () => {
    const { chats, id } = await savedChat()

    await chats.deleteChat(id)

    expect(chats.getAllSessions()).toHaveLength(1)
    expect(chats.getAllSessions()[0].currentChatFile.value).toBeNull()
  })

  it('has nothing to delete for a tab nobody has written to yet', async () => {
    const chats = ChatService.getInstance()
    const id = chats.createTab()

    expect(await chats.deleteChat(id)).toBe(false)

    expect(chats.getSession(id)).not.toBeNull()
  })

  it('says nothing happened for a tab that is not there', async () => {
    expect(await ChatService.getInstance().deleteChat('nope')).toBe(false)
  })
})

/**
 * A comment that was opened as a chat is still anchored in a note, and the note still holds its
 * marker. Deleting only the file would leave an icon in the text that opens nothing for ever.
 */
describe('deleting a chat that was a comment', () => {
  it('takes the marker out of the note with it', async () => {
    const comments = CommentService.getInstance()
    const session = await comments.create(noteFile(), QUOTE.length, QUOTE)
    ;(session as unknown as { allChatMessages: unknown[] }).allChatMessages = [
      { id: 'm1', role: 'user', content: 'what about this', timestamp: 1 },
    ]
    await session.save()
    const commentId = session.commentId!
    expect(await comments.expand(commentId)).toBe('moved')

    expect(await ChatService.getInstance().deleteChat(session.id)).toBe(true)

    expect(await app.vault.read(noteFile())).toBe(`${QUOTE} and more.`)
    expect(app.vault.getAbstractFileByPath(comments.commentPath(commentId))).toBeNull()
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
  })
})
