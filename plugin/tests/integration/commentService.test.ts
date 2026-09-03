/**
 * A comment, from the marker in the note to the file on disk.
 *
 * The two things worth guarding are that a comment stays out of the chat history until
 * someone expands it — it is a margin note, not a conversation anyone browses — and that one
 * file only ever has one session writing it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChatMetadata } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

// The editor is not standing up here: `dispatchCommentsChanged` walks the workspace's leaves,
// which a fake vault has none of. What matters to these tests is that it is called.
vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE = 'Before. The selected passage After.\n'
/** Offset of the character just past "The selected passage", where the marker goes. */
const SELECTION_END = NOTE.indexOf(' After.')

let app: FakeApp

const noteFile = () => app.vault.getAbstractFileByPath('Notes/A.md') as TFile
const noteText = async () => (await app.vault.read(noteFile())) as string

beforeEach(() => {
  app = useVault([{ path: 'Notes/A.md', content: NOTE }])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  // Both singletons outlive a test file, and the expansion tests put sessions into this one.
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
  const fallback = registry.create({ name: 'Default' })
  registry.setDefault(fallback.id)
  AbeleConfig.getInstance().ai.commentAgentId = registry.create({
    name: 'Comment',
    utility: true,
  }).id
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})

describe('creating a comment', () => {
  it('writes the marker into the note at the end of the selection', async () => {
    const session = await CommentService.getInstance().create(
      noteFile(),
      SELECTION_END,
      'The selected passage'
    )

    expect(await noteText()).toBe(`Before. The selected passage%%c:${session.commentId}%% After.\n`)
  })

  it('writes a file in the comment folder carrying the anchor', async () => {
    const service = CommentService.getInstance()

    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    const file = app.vault.getAbstractFileByPath(service.commentPath(session.commentId!))
    expect(file).toBeInstanceOf(TFile)
    const metadata = parseChatMetadata((await app.vault.read(file as TFile)) as string)
    expect(metadata?.kind).toBe('comment')
    expect(metadata?.anchor).toEqual({ note: 'Notes/A.md', quote: 'The selected passage' })
    expect(metadata?.agentId).toBe(AbeleConfig.getInstance().ai.commentAgentId)
  })

  it('leaves a live session behind, on the comment agent, with the note in scope', async () => {
    const service = CommentService.getInstance()

    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    expect(service.sessions.get(session.commentId!)).toBe(session)
    expect(session.kind).toBe('comment')
    expect(session.agentId.value).toBe(AbeleConfig.getInstance().ai.commentAgentId)
    expect(session.scopeResolver.isInScope('Notes/A.md')).toBe(true)
  })

  it('stays out of the chat history until somebody expands it', async () => {
    await CommentService.getInstance().create(noteFile(), SELECTION_END, 'The selected passage')

    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  it('appends its id to the marker already there rather than writing a second one', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    const second = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    expect(await noteText()).toBe(
      `Before. The selected passage%%c:${first.commentId},${second.commentId}%% After.\n`
    )
    expect(service.sessions.size).toBe(2)
  })
})

describe('reporting to the editor', () => {
  it('gives the quote and the idle state for a loaded comment', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    expect(service.get(session.commentId!)).toEqual({
      quote: 'The selected passage',
      state: 'idle',
      open: false,
    })
  })

  it('knows nothing about an id it has never loaded', () => {
    expect(CommentService.getInstance().get('zzz999')).toBeUndefined()
  })

  it('loads a comment it has not seen, once', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    service.destroy()

    const loaded = await CommentService.getInstance().load(id)

    expect(loaded?.anchor.value).toEqual({ note: 'Notes/A.md', quote: 'The selected passage' })
    expect(await CommentService.getInstance().load(id)).toBe(loaded)
  })

  it('returns null for an id with no file', async () => {
    expect(await CommentService.getInstance().load('zzz999')).toBeNull()
  })
})

describe('removing a comment', () => {
  it('takes the id out of the marker, the file off disk and the session out of the map', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!

    await service.remove(id)

    expect(await noteText()).toBe(NOTE)
    expect(app.vault.getAbstractFileByPath(service.commentPath(id))).toBeNull()
    expect(service.sessions.has(id)).toBe(false)
  })

  it('leaves the marker in place while another comment still uses it', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const second = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    await service.remove(first.commentId!)

    expect(await noteText()).toBe(`Before. The selected passage%%c:${second.commentId}%% After.\n`)
  })
})

/** A comment with something in it, since an empty one has nothing to expand into. */
async function answeredComment() {
  const service = CommentService.getInstance()
  const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
  ;(session as unknown as { allChatMessages: unknown[] }).allChatMessages = [
    { id: 'm1', role: 'user', content: 'what does this mean?', timestamp: 1 },
  ]
  await session.save()
  return session
}

describe('expanding a comment into a chat', () => {
  it('flips the kind, in memory and in the file', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)

    expect(session.kind).toBe('chat')
    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    expect(parseChatMetadata((await app.vault.read(file)) as string)?.kind).toBe('chat')
  })

  it('keeps the anchor, so the marker still finds the file', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()

    await service.expand(session.commentId!)

    expect(session.anchor.value?.note).toBe('Notes/A.md')
    expect(session.scopeResolver.isInScope('Notes/A.md')).toBe(true)
  })

  it('moves it onto the default agent', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()

    await service.expand(session.commentId!)

    expect(session.agentId.value).toBe(AgentRegistry.getInstance().defaultAgent()?.id)
  })

  it('puts it in the chat history and hands it to the sidebar as a tab', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)

    expect(AbeleConfig.getInstance().ai.chatHistory.map((e) => e.path)).toEqual([
      service.commentPath(id),
    ])
    expect(ChatService.getInstance().getSessionByFile(service.commentPath(id))).toBe(session)
    expect(ChatService.getInstance().revealSidebar).toHaveBeenCalled()
  })

  it('takes edit_selection away, because it is no longer a comment', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()

    await service.expand(session.commentId!)

    expect(session.toolDefs().map((t) => t.name)).not.toContain('edit_selection')
  })

  it('is still the one session for that id, so nothing loads the file twice', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)

    expect(service.sessions.has(id)).toBe(false)
    expect(service.get(id)?.state).toBe('idle')
    expect(await service.load(id)).toBe(session)
  })
})

describe('the note being renamed', () => {
  it('follows it in a comment nobody has open', async () => {
    const service = CommentService.getInstance()
    const session = await CommentService.getInstance().create(
      noteFile(),
      SELECTION_END,
      'The selected passage'
    )
    const id = session.commentId!
    service.destroy()

    await CommentService.getInstance().handleRename('Notes/A.md', 'Notes/B.md')

    const file = app.vault.getAbstractFileByPath(
      CommentService.getInstance().commentPath(id)
    ) as TFile
    expect(parseChatMetadata((await app.vault.read(file)) as string)?.anchor).toEqual({
      note: 'Notes/B.md',
      quote: 'The selected passage',
    })
  })

  it('follows it in a comment already loaded', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    await service.handleRename('Notes/A.md', 'Notes/B.md')

    expect(session.anchor.value?.note).toBe('Notes/B.md')
  })

  it('leaves a comment on some other note alone', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    await service.handleRename('Notes/Elsewhere.md', 'Notes/Moved.md')

    expect(session.anchor.value?.note).toBe('Notes/A.md')
  })
})
