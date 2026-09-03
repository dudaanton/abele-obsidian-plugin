/**
 * A comment, from the marker in the note to the file on disk.
 *
 * The two things worth guarding are that a comment stays out of the chat history until
 * someone expands it — it is a margin note, not a conversation anyone browses — and that one
 * file only ever has one session writing it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { nextTick, toRaw } from 'vue'
import { TFile } from 'obsidian'
import { CommentService } from '@/ai/CommentService'
import { dispatchCommentsChanged } from '@/editor/CommentPlugin'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatStorage } from '@/ai/ChatStorage'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { CommentEntry } from '@/entities/Comment'
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
  GlobalStore.getInstance().commentsContainers.value = []
  GlobalStore.getInstance().commentSheet.value = null
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

  /**
   * The phone's case, end to end.
   *
   * The marker is an atomic widget, so a second selection dragged as far as the icon ends on
   * the marker's far side rather than at its start. That used to write a second marker beside
   * the first — two icons, one comment each, and no count on either, which is what the phone
   * reported.
   */
  it('appends its id when the second selection ended on the far side of the marker', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const markerEnd = SELECTION_END + `%%c:${first.commentId}%%`.length

    const second = await service.create(noteFile(), markerEnd, 'The selected passage')

    expect(await noteText()).toBe(
      `Before. The selected passage%%c:${first.commentId},${second.commentId}%% After.\n`
    )
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

  /**
   * The editor may have started reading the file the moment before the person hit delete.
   * Adopting that read afterwards would put the comment back with no file behind it.
   */
  it('does not adopt a load that was already reading the file', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    service.destroy()

    const reloaded = CommentService.getInstance()
    const inFlight = reloaded.load(id)
    await reloaded.remove(id)

    expect(await inFlight).toBeNull()
    expect(reloaded.sessions.has(id)).toBe(false)
    expect(reloaded.get(id)).toBeUndefined()
  })

  it('leaves the marker in place while another comment still uses it', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const second = await service.create(noteFile(), SELECTION_END, 'The selected passage')

    await service.remove(first.commentId!)

    expect(await noteText()).toBe(`Before. The selected passage%%c:${second.commentId}%% After.\n`)
  })
})

/**
 * A comment with something in it, since an empty one has nothing to expand into.
 *
 * The message goes into both the whole conversation and the visible path, which is what
 * `appendChatMessage` does for a real turn — the visible one is what the card and the title
 * read from, so setting only the private list would be a fixture nothing else resembles.
 */
async function answeredComment() {
  const service = CommentService.getInstance()
  const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
  const asked = { id: 'm1', role: 'user', content: 'what does this mean?', timestamp: 1 }
  ;(session as unknown as { allChatMessages: unknown[] }).allChatMessages = [asked]
  session.messages.value = [asked as never]
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

  it('names the history entry after the question that was asked', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)

    expect(AbeleConfig.getInstance().ai.chatHistory[0].title).toBe('what does this mean?')
  })

  it('falls back to the id when there is nothing to name it after', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!

    await service.expand(id)

    expect(AbeleConfig.getInstance().ai.chatHistory[0].title).toBe(id)
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

/**
 * The way back, which is what an expanded comment had none of: everything `expand` did is
 * undone, and the one thing that must not happen is the conversation ending. The session goes
 * on writing the same file — it only stops being a tab and becomes a card again.
 *
 * Sessions are compared with `===` rather than handed to `toBe`: a `ChatSession` printed as a
 * diff is pages of reactive internals, and identity is the whole question here.
 */
describe('returning an expanded comment to its note', () => {
  it('puts the kind back, in memory and in the file', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    await service.collapse(id)

    expect(session.kind).toBe('comment')
    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    expect(parseChatMetadata((await app.vault.read(file)) as string)?.kind).toBe('comment')
  })

  it('puts it back on the comment agent', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()

    await service.expand(session.commentId!)
    await service.collapse(session.commentId!)

    expect(session.agentId.value).toBe(AbeleConfig.getInstance().ai.commentAgentId)
  })

  /** No `commentAgentId`, no agent to go back to — and a comment on no agent answers nothing. */
  it('stays on the chat agent when no comment agent is configured', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    AbeleConfig.getInstance().ai.commentAgentId = ''

    await service.expand(session.commentId!)
    await service.collapse(session.commentId!)

    expect(session.agentId.value).toBe(AgentRegistry.getInstance().defaultAgent()?.id)
  })

  it('takes it out of the chat history, since it is a margin note again', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()

    await service.expand(session.commentId!)
    await service.collapse(session.commentId!)

    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  it('closes the tab without ending the conversation in it', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const chatService = ChatService.getInstance()

    await service.expand(id)
    await service.collapse(id)

    expect(chatService.getSessionByFile(service.commentPath(id))).toBeNull()
    expect(chatService.tabOrder.value).not.toContain(session.id)
    expect(session.isDestroyed).toBe(false)
  })

  /** The sidebar has to show something, and an empty tab bar is a sidebar that shows nothing. */
  it('leaves a tab behind when the comment was the only one', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const chatService = ChatService.getInstance()

    await service.expand(session.commentId!)
    await service.collapse(session.commentId!)

    expect(chatService.tabOrder.value).toHaveLength(1)
    expect(chatService.tabOrder.value).not.toContain(session.id)
  })

  it('is the same session, answering for the same id, back in the margin', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    await service.collapse(id)

    expect(service.sessions.has(id)).toBe(true)
    expect(service.sessionFor(id) === session).toBe(true)
    expect((await service.load(id)) === session).toBe(true)
  })

  it('opens the card again and repaints the note it is anchored to', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    vi.mocked(dispatchCommentsChanged).mockClear()
    await service.collapse(id)

    expect(service.open.value).toBe(id)
    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('does nothing for a comment that was never expanded', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.collapse(id)

    expect(session.kind).toBe('comment')
    expect(service.open.value).toBeNull()
  })
})

describe('an expanded comment whose tab is closed', () => {
  /**
   * `closeTab` destroys the session. Holding on to the corpse leaves the marker reporting a
   * state nothing updates and unable to open anything, so it is dropped and read again.
   */
  it('is read from the file again rather than answered from the closed session', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    await service.expand(id)

    await ChatService.getInstance().closeTab(session.id)

    expect(service.get(id)).toBeUndefined()
    const reopened = await service.load(id)
    // Compared as a boolean: a failed identity check on a session would have vitest diff two
    // reactive object graphs against each other, which exhausts the heap before it prints.
    expect(reopened === session).toBe(false)
    expect(reopened?.anchor.value?.note).toBe('Notes/A.md')
  })

  it('opens again from the file explorer', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = service.sessions.keys().next().value as string
    await service.expand(id)
    await ChatService.getInstance().closeTab(session.id)

    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    await service.openFile(file)

    expect(ChatService.getInstance().getSessionByFile(service.commentPath(id))).toBeTruthy()
  })

  /** Each reopening expands again, and a history that lists one chat twice is a list nobody trusts. */
  it('is listed in the history once, however often it is reopened', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = service.sessions.keys().next().value as string
    await service.expand(id)
    await ChatService.getInstance().closeTab(session.id)

    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    await service.openFile(file)

    const listed = AbeleConfig.getInstance().ai.chatHistory?.filter((e) => e.path === file.path)
    expect(listed).toHaveLength(1)
  })
})

describe('an expanded comment after a restart', () => {
  /**
   * `restoreTabs` rebuilds it as an ordinary chat tab, and the marker is still in the note —
   * so the first `touch` must find that session rather than build a second one on the file.
   */
  it('is answered from the tab ChatService already restored, not loaded twice', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    await service.expand(id)
    // A restart: CommentService forgets everything, ChatService keeps the tab.
    const restored = ChatService.getInstance().getSessionByFile(service.commentPath(id))
    CommentService.getInstance().destroy()

    const found = await CommentService.getInstance().load(id)

    expect(found === restored).toBe(true)
    expect(CommentService.getInstance().get(id)?.quote).toBe('The selected passage')
  })

  /**
   * And the other order, which is the one that actually happens: the note's editor is up
   * before `onLayoutReady`, so the comment has a session before `restoreTabs` sees the saved
   * layout. Building a second one there would put two log writers on one `.abchat`.
   */
  it('is the session ChatService restores, not a second one on the same file', async () => {
    const service = CommentService.getInstance()
    const created = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = created.commentId!
    const path = service.commentPath(id)
    app.saveLocalStorage('abele-agent-tabs', { tabs: [{ chatFilePath: path }], activeIndex: 0 })

    // A restart: both singletons are new, and the editor gets there first.
    service.destroy()
    ChatService.getInstance().destroy()
    vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
    const loaded = await CommentService.getInstance().load(id)

    await ChatService.getInstance().restoreTabs()

    expect(ChatService.getInstance().getSessionByFile(path) === loaded).toBe(true)
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(1)
  })
})

describe('a comment whose file will not read', () => {
  // The read is faked on the prototype, so it has to be put back before the next test loads
  // anything. The spies `beforeEach` sets up are made again there.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is written off rather than left half-built, and is not tried again', async () => {
    const service = CommentService.getInstance()
    const created = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = created.commentId!
    service.destroy()

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const read = vi
      .spyOn(ChatSession.prototype, 'load')
      .mockRejectedValue(new Error('corrupt comment'))
    const fresh = CommentService.getInstance()

    expect(await fresh.load(id)).toBeNull()
    expect(fresh.sessions.size).toBe(0)
    expect((read.mock.instances[0] as ChatSession).isDestroyed).toBe(true)

    // Written off, so the marker repainting does not start the same failing read for ever.
    fresh.touch('Notes/A.md', [id])
    await nextTick()
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('opening a comment file by hand', () => {
  it('is recognised by its path', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const file = app.vault.getAbstractFileByPath(service.commentPath(session.commentId!)) as TFile

    expect(service.isCommentFile(file)).toBe(true)
  })

  it('does not claim an ordinary chat file', async () => {
    const file = (await app.vault.create('AI/Chats/Some chat.abchat', '')) as TFile

    expect(CommentService.getInstance().isCommentFile(file)).toBe(false)
  })

  it('expands it into a tab', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile

    await service.openFile(file)

    expect(session.kind).toBe('chat')
    expect(ChatService.getInstance().getSessionByFile(file.path) === session).toBe(true)
    expect(ChatService.getInstance().revealSidebar).toHaveBeenCalled()
  })

  it('just shows the tab when it is already open', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    await service.openFile(file)
    const tabs = ChatService.getInstance().getAllSessions().length

    await service.openFile(file)

    expect(ChatService.getInstance().getAllSessions()).toHaveLength(tabs)
  })

  it('does nothing for a comment file with no session and no content', async () => {
    const file = (await app.vault.create('AI/Comments/nope99.abchat', '')) as TFile

    await expect(CommentService.getInstance().openFile(file)).resolves.toBeUndefined()
  })
})

describe('shutting the service down', () => {
  it('lets go of every comment and forgets which card was open', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    service.open.value = id

    service.destroy()

    expect(service.sessions.size).toBe(0)
    expect(service.open.value).toBeNull()
    expect(CommentService.getInstance()).not.toBe(service)
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

describe('which card is open', () => {
  it('opens the first comment of a marker and closes it again', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string

    service.toggleOpen([id])
    expect(service.open.value).toBe(id)

    service.toggleOpen([id])
    expect(service.open.value).toBeNull()
  })

  it('moves the open card rather than closing it when another marker is pressed', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    service.open.value = first.commentId

    service.toggleOpen(['zzz999'])

    expect(service.open.value).toBe('zzz999')
  })

  it('repaints the note that lost the open card and the note that gained one', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    vi.mocked(dispatchCommentsChanged).mockClear()

    service.open.value = session.commentId
    await nextTick()

    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })
})

describe('choosing a host for the card', () => {
  const hostFor = (ids: string[]) =>
    new CommentEntry({ id: 'vue-1', ids, notePath: 'Notes/A.md', markerFrom: SELECTION_END })

  it('leaves the card in the margin when the pane has room for one', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string
    GlobalStore.getInstance().commentsContainers.value = [hostFor([id])]

    service.openFrom([id], true)

    expect(service.open.value).toBe(id)
    expect(GlobalStore.getInstance().commentSheet.value).toBeNull()
  })

  it('sends it to a sheet when there is no margin to put it in', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string
    const host = hostFor([id])
    GlobalStore.getInstance().commentsContainers.value = [host]

    service.openFrom([id], false)

    // The sheet expands the card itself, on mount: one value says which card is open, and the
    // sheet is the thing that knows it is showing one.
    // `toRaw`: the store's list is a deep-reactive ref, so what came back is a proxy of the
    // very entry the margin is hosting — which is the point of the assertion.
    expect(toRaw(GlobalStore.getInstance().commentSheet.value)).toBe(host)
    expect(service.open.value).toBeNull()
  })

  it('still opens a sheet when the marker has no host in the margin', async () => {
    // The hosts belong to live-preview views and are dropped when one closes. A press that
    // lands between the drop and the rebuild must still open the conversation; the note comes
    // from the comment's own anchor, which is what the sheet titles itself with.
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string

    service.openFrom([id], false)

    expect(GlobalStore.getInstance().commentSheet.value?.ids).toEqual([id])
    expect(GlobalStore.getInstance().commentSheet.value?.notePath).toBe('Notes/A.md')
  })

  it('does nothing at all for an id nothing knows about', async () => {
    const service = CommentService.getInstance()

    service.openFrom(['zzz999'], false)

    expect(GlobalStore.getInstance().commentSheet.value).toBeNull()
  })
})

/** Lets Promise chains and their `.then` continuations run to the end. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a comment file appearing under the folder', () => {
  it('lets a marker that had given up on it find it again', async () => {
    const service = CommentService.getInstance()
    service.touch('Notes/A.md', ['zzz999'])
    await flush()
    const load = vi.spyOn(service, 'load')

    // Written directly, the way a sync or a restore would put it there — not through `create`.
    await app.vault.create(
      service.commentPath('zzz999'),
      serializeChat({
        metadata: {
          type: 'abele-chat',
          kind: 'comment',
          anchor: { note: 'Notes/A.md', quote: 'The selected passage' },
          providerId: 'p1',
          modelId: 'm1',
          created: '2026-09-02',
        },
        messages: [],
        internalMessages: [],
      })
    )

    service.handleFileCreated('zzz999')
    service.touch('Notes/A.md', ['zzz999'])
    await flush()

    expect(load).toHaveBeenCalledWith('zzz999')
    expect(service.sessions.has('zzz999')).toBe(true)
  })

  it('repaints the note of a comment the service already has a session for', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    vi.mocked(dispatchCommentsChanged).mockClear()
    // `missing` and a live session do not actually overlap in practice — this pins the branch
    // that repaints when the service already knows the id, in case a stale event ever crosses
    // one with the other.
    ;(service as unknown as { missing: Set<string> }).missing.add(id)

    service.handleFileCreated(id)

    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('does nothing for an id that was never missing', () => {
    const service = CommentService.getInstance()
    vi.mocked(dispatchCommentsChanged).mockClear()

    service.handleFileCreated('never999')

    expect(vi.mocked(dispatchCommentsChanged)).not.toHaveBeenCalled()
  })
})

describe('a comment file disappearing from under the folder', () => {
  it('forgets the session and repaints the note that showed it', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    vi.mocked(dispatchCommentsChanged).mockClear()

    service.handleFileDeleted(id)

    expect(service.sessions.has(id)).toBe(false)
    expect(session.isDestroyed).toBe(true)
    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('clears the open card if it was the one showing', async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId!
    service.open.value = id

    service.handleFileDeleted(id)

    expect(service.open.value).toBeNull()
  })

  it('does nothing for an id nobody was tracking', () => {
    const service = CommentService.getInstance()
    vi.mocked(dispatchCommentsChanged).mockClear()

    service.handleFileDeleted('zzz999')

    expect(vi.mocked(dispatchCommentsChanged)).not.toHaveBeenCalled()
  })
})
