/**
 * A pinned message inside a comment.
 *
 * Pinning is a view concern with a file behind it: the ids live in the comment's own metadata
 * so the margin comes back the way it was left, and nowhere else — no copy in the store, none
 * in a component. These tests are about the file, which is the part a restart depends on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChatMetadata } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

// The editor is not standing up here, and a fake vault has no leaves for it to walk.
vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE = 'Before. The selected passage After.\n'
const SELECTION_END = NOTE.indexOf(' After.')

let app: FakeApp

const noteFile = () => app.vault.getAbstractFileByPath('Notes/A.md') as TFile

beforeEach(() => {
  app = useVault([{ path: 'Notes/A.md', content: NOTE }])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Default' }).id)
  AbeleConfig.getInstance().ai.commentAgentId = registry.create({
    name: 'Comment',
    utility: true,
  }).id
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  GlobalStore.getInstance().commentsContainers.value = []
})

/** A comment with one answered turn in it, the way `answeredComment` does it next door. */
async function answeredComment() {
  const session = await CommentService.getInstance().create(
    noteFile(),
    SELECTION_END,
    'The selected passage'
  )
  const asked = { id: 'm1', role: 'user', content: 'what does this mean?', timestamp: 1 }
  ;(session as unknown as { allChatMessages: unknown[] }).allChatMessages = [asked]
  session.messages.value = [asked as never]
  await session.save()
  return session
}

const metadataOf = async (id: string) => {
  const path = CommentService.getInstance().commentPath(id)
  const file = app.vault.getAbstractFileByPath(path) as TFile
  return parseChatMetadata((await app.vault.read(file)) as string)
}

describe('pinning a message in a comment', () => {
  it('writes the message id into the comment file', async () => {
    const session = await answeredComment()

    await session.pin('m1')

    expect(session.pinned.value).toEqual(['m1'])
    expect((await metadataOf(session.commentId!))?.pinned).toEqual(['m1'])
  })

  it('pins a message only once, however often it is asked', async () => {
    const session = await answeredComment()

    await session.pin('m1')
    await session.pin('m1')

    expect(session.pinned.value).toEqual(['m1'])
    expect(session.isPinned('m1')).toBe(true)
    expect(session.isPinned('m2')).toBe(false)
  })

  it('comes back pinned in a session that loads the same file', async () => {
    const session = await answeredComment()
    await session.pin('m1')

    const reopened = new ChatSession()
    const path = CommentService.getInstance().commentPath(session.commentId!)
    await reopened.load(app.vault.getAbstractFileByPath(path) as TFile)

    expect(reopened.pinned.value).toEqual(['m1'])
    reopened.destroy()
  })

  it('leaves `pinned` out of the file altogether once the last one is unpinned', async () => {
    const session = await answeredComment()
    await session.pin('m1')

    await session.unpin('m1')

    expect(session.pinned.value).toEqual([])
    // Absent, not an empty array: nothing should carry the weight of a field it does not use.
    expect((await metadataOf(session.commentId!))?.pinned).toBeUndefined()

    const reopened = new ChatSession()
    const path = CommentService.getInstance().commentPath(session.commentId!)
    await reopened.load(app.vault.getAbstractFileByPath(path) as TFile)
    expect(reopened.pinned.value).toEqual([])
    reopened.destroy()
  })

  it('does nothing when asked to unpin something that is not pinned', async () => {
    const session = await answeredComment()
    await session.pin('m1')

    await session.unpin('m2')

    expect(session.pinned.value).toEqual(['m1'])
  })
})
