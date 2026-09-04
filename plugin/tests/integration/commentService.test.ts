/**
 * A comment, from the marker in the note to the file on disk.
 *
 * The two things worth guarding are that a comment stays out of the chat history until
 * someone expands it — it is a margin note, not a conversation anyone browses — and that one
 * file only ever has one session writing it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import { Notice, TFile } from 'obsidian'
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
  GlobalStore.getInstance().commentModal.value = null
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
      pinned: [],
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

  /**
   * The card folds when the conversation leaves it.
   *
   * "Open as chat" is pressed on a card that is open, and the conversation goes to the
   * sidebar. A card left open over it is a second, read-only copy of a conversation somebody
   * can already answer in — and the marker, which draws itself open from the same value,
   * would go on saying there is something beside the text.
   */
  it('folds the card it was promoted from', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    service.open.value = id

    await service.expand(id)

    expect(service.open.value).toBeNull()
  })
})

/**
 * The marker of a comment that became a chat.
 *
 * There is no way back to a card any more, and no button on the card offering one: those two
 * were what 1.17.0 left behind, and what the person asking for this called "не понятно зачем
 * нужны". The marker is the way in, and it has to work after the tab has been closed — which
 * is the dead end that came with them.
 */
/**
 * The tab bar is full, and "open as chat" was pressed anyway.
 *
 * `adoptSession` keeps the limit — a phone hides the strip, so tabs piled up past it are tabs
 * nobody can reach — and `expand` used to find that out last: the file already said `chat`,
 * the history already had an entry, and there was no tab. Nothing may move until the sidebar
 * has said it will take it.
 */
describe('a comment promoted with no room left in the tab bar', () => {
  const full = async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const chats = ChatService.getInstance()
    for (let i = 0; i < 8; i++) chats.createTab()
    Notice.shown.length = 0
    return { service, session, id }
  }

  it('says why, and does not say it is the agent fault', async () => {
    const { service, id } = await full()

    expect(await service.expand(id)).toBe('no-room')

    expect(Notice.shown.join(' ')).toContain('8 open tabs')
  })

  it('leaves it a comment: the file, the maps and the history all untouched', async () => {
    const { service, session, id } = await full()

    await service.expand(id)

    expect(session.kind).toBe('comment')
    expect(service.sessions.get(id) === session).toBe(true)
    const file = app.vault.getAbstractFileByPath(service.commentPath(id)) as TFile
    expect(parseChatMetadata((await app.vault.read(file)) as string)?.kind).toBe('comment')
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  /** And the marker still opens what it always opened, rather than a chat nothing is holding. */
  it('leaves the marker opening a card', async () => {
    const { service, id } = await full()
    await service.expand(id)

    service.openFrom([id], true, 'Notes/A.md')

    expect(service.open.value).toBe(id)
  })
})

describe('a press on the marker of an expanded comment', () => {
  const expanded = async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    await service.expand(id)
    return { service, session, id }
  }

  it('opens the chat it became, wherever the pane has room', async () => {
    const { service, session, id } = await expanded()
    const reveal = vi.spyOn(ChatService.getInstance(), 'revealSidebar')

    service.openFrom([id], true, 'Notes/A.md')
    await flush()

    expect(ChatService.getInstance().getSession(session.id) === session).toBe(true)
    expect(reveal).toHaveBeenCalled()
    expect(service.open.value).toBeNull()
  })

  it('opens it in a dialog-less pane too, because a chat lives in the sidebar', async () => {
    const { service, session, id } = await expanded()

    service.openFrom([id], false, 'Notes/A.md')
    await flush()

    expect(ChatService.getInstance().getSession(session.id) === session).toBe(true)
    expect(GlobalStore.getInstance().commentModal.value).toBeNull()
  })

  /** The dead end: closing the tab used to leave the marker pointing at nothing reachable. */
  it('opens it again after its tab has been closed', async () => {
    const { service, session, id } = await expanded()
    ChatService.getInstance().dropTab(session.id)
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()

    service.openFrom([id], true, 'Notes/A.md')
    await flush()

    expect(ChatService.getInstance().getSession(session.id) === session).toBe(true)
  })
})
/**
 * Moving a comment while its agent is still working.
 *
 * Both moves rebind the agent, and rebinding appends a divider and re-syncs the scope — into
 * a request that has already been built from both, and, when a tool call is waiting, between
 * a `tool_use` and the `tool_result` that has to follow it. So both are refused for as long as
 * `addUserNote` refuses a note, and for the same reason. The refusal is a `false`, not a
 * throw: the card and the sidebar say why.
 */
describe('a comment whose agent is mid-turn', () => {
  /** One waiting tool call, as far as anything reading `pendingToolCalls` can tell. */
  const A_TOOL_CALL = [{ id: 'tc1', name: 'read_note', input: {} }] as never

  it('is not promoted while the answer is still arriving', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    session.isStreaming.value = true

    expect(await service.expand(id)).toBe('busy')

    expect(session.kind).toBe('comment')
    expect(session.agentId.value).toBe(AbeleConfig.getInstance().ai.commentAgentId)
    expect(service.sessions.get(id) === session).toBe(true)
    expect(ChatService.getInstance().getSessionByFile(service.commentPath(id))).toBeNull()
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  it('is not promoted while a tool call is waiting to be approved', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    session.pendingToolCalls.value = A_TOOL_CALL

    expect(await service.expand(id)).toBe('busy')

    expect(session.kind).toBe('comment')
    expect(service.sessions.get(id) === session).toBe(true)
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  it('leaves the conversation untouched when a promotion is refused', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const before = session.allMessages.value.length
    session.isStreaming.value = true

    await service.expand(id)

    expect(session.allMessages.value).toHaveLength(before)
  })
})

/**
 * A write that fails in the middle of a move.
 *
 * The file is the one thing both sides of a move have to agree with: a session filed as a
 * comment over a file that still says "chat" is loaded twice on the next restart, once by the
 * marker and once by the tab that was restored — two writers on one log. So the persisted
 * change goes first and the moves wait on it, and a save that throws puts back everything it
 * was given.
 */
describe('a move whose save fails', () => {
  const refuseToSave = (session: ChatSession) =>
    vi.spyOn(session, 'save').mockRejectedValue(new Error('disk full'))

  it('leaves the comment a comment when promoting it cannot be written', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    refuseToSave(session)

    await expect(service.expand(id)).rejects.toThrow('disk full')

    expect(session.kind).toBe('comment')
    expect(session.agentId.value).toBe(AbeleConfig.getInstance().ai.commentAgentId)
    expect(service.sessions.get(id) === session).toBe(true)
    expect(ChatService.getInstance().getSessionByFile(service.commentPath(id))).toBeNull()
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })
})

/**
 * Two presses on the same move.
 *
 * A move writes the file and only then moves the maps that answer for the id, so a second one
 * starting inside that gap works from a conversation half of which has already moved: a second
 * history entry, or a session dropped from `sessions` and never filed under `expanded`. The
 * session says it is on its way, and the second press is refused with that.
 */
describe('a comment already being moved', () => {
  /** A save that hangs until it is let go, which is what holds a move open. */
  function hangingSave(session: ChatSession) {
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(session, 'save').mockImplementation(() => held)
    return release
  }

  it('refuses a second promotion while the first is still writing', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const release = hangingSave(session)

    const first = service.expand(id)
    await nextTick()

    expect(session.moving.value).toBe(true)
    expect(await service.expand(id)).toBe('busy')
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])

    release()
    expect(await first).toBe('moved')
    expect(session.moving.value).toBe(false)
    expect(AbeleConfig.getInstance().ai.chatHistory).toHaveLength(1)
  })
  it('is on its way again once a failed move has let go', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    vi.spyOn(session, 'save').mockRejectedValueOnce(new Error('disk full'))

    await expect(service.expand(id)).rejects.toThrow('disk full')

    expect(session.moving.value).toBe(false)
    expect(await service.expand(id)).toBe('moved')
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
   * A tab saved over a comment that is still a comment, which 1.17.1 could leave behind when
   * it lent the sidebar to comments. Restoring one now would put a card's session in a bar
   * whose × means "close", over a file the margin is still writing — so the tab is dropped,
   * and above all no second session is built on the file the margin already has open.
   */
  it('leaves a saved tab over a plain comment unrestored', async () => {
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

    expect(ChatService.getInstance().getSessionByFile(path)).toBeNull()
    expect(CommentService.getInstance().sessionFor(id) === loaded).toBe(true)
    expect(loaded?.isDestroyed).toBe(false)
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

describe('a comment where the margin has no room for it', () => {
  const hostFor = (ids: string[]) =>
    new CommentEntry({ id: 'vue-1', ids, notePath: 'Notes/A.md', markerFrom: SELECTION_END })

  const made = async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string
    return { service, session, id }
  }

  const dialog = () => GlobalStore.getInstance().commentModal.value

  it('leaves the card in the margin when the pane has room for one', async () => {
    const { service, id } = await made()
    GlobalStore.getInstance().commentsContainers.value = [hostFor([id])]

    service.openFrom([id], true, 'Notes/A.md')

    expect(service.open.value).toBe(id)
    expect(dialog()).toBeNull()
  })

  /**
   * A phone, and a split too narrow for a sidenote. The card goes into a dialog of its own —
   * not into the chat sidebar, which 1.17.1 tried: that view is the agent's, with its tabs and
   * its history, and a comment borrowed into it is a comment in somebody else's room.
   */
  it('puts the card in a dialog when there is nowhere to hang one', async () => {
    const { service, id } = await made()
    GlobalStore.getInstance().commentsContainers.value = [hostFor([id])]

    service.openFrom([id], false, 'Notes/A.md')

    expect(dialog()?.ids).toEqual([id])
    expect(ChatService.getInstance().getAllSessions()).toEqual([])
  })

  /** One card is one component: the dialog takes the host the margin already made, if any. */
  it('reuses the margin host for the same marker', async () => {
    const { service, id } = await made()
    const host = hostFor([id])
    GlobalStore.getInstance().commentsContainers.value = [host]

    service.openFrom([id], false, 'Notes/A.md')

    expect(dialog()?.id).toBe(host.id)
  })

  /**
   * Hosts are only minted where there is a margin to hang them in, which is exactly what a
   * phone has not. The note comes from the pane the icon was pressed in — a marker pressed
   * before its comment has been read off disk still knows which note it is in.
   */
  it('mints a host for a marker the margin never drew', async () => {
    const { service, id } = await made()
    GlobalStore.getInstance().commentsContainers.value = []

    service.openFrom([id], false, 'Notes/A.md')

    expect(dialog()?.notePath).toBe('Notes/A.md')
    expect(dialog()?.ids).toEqual([id])
  })

  it('opens one for a comment nothing has loaded yet', async () => {
    const service = CommentService.getInstance()
    GlobalStore.getInstance().commentsContainers.value = []

    service.openFrom(['zzz999'], false, 'Notes/A.md')

    expect(dialog()?.ids).toEqual(['zzz999'])
  })

  /** No note, no card: there would be nothing for the thread to render against. */
  it('does nothing at all for a press that names no note', async () => {
    const service = CommentService.getInstance()
    GlobalStore.getInstance().commentsContainers.value = []

    service.openFrom(['zzz999'], false, '')

    expect(dialog()).toBeNull()
  })

  /**
   * The margin is left alone: `open` is what the marker draws itself from, and the dialog
   * expands the card on mount from that same value.
   */
  it('leaves the open card alone', async () => {
    const { service, id } = await made()

    service.openFrom([id], false, 'Notes/A.md')

    expect(service.open.value).toBeNull()
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
