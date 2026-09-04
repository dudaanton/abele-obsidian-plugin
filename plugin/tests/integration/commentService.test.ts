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

  /**
   * Folded, not expanded.
   *
   * It used to open the card, on the reasoning that the reader had pressed "back to the note"
   * and the card was what they were coming back to. But the same button is in the sidebar,
   * where the pane may have no margin at all — and an `open` card nothing can draw leaves the
   * marker painted open over a passage with nothing beside it. Folded is honest at every width,
   * and one tap opens it as whatever the pane can show. The card's own way back is unaffected:
   * it is only offered on a card that is already open, so `open` is already this id.
   */
  it('leaves the card folded and repaints the note it is anchored to', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    vi.mocked(dispatchCommentsChanged).mockClear()
    await service.collapse(id)

    expect(service.open.value).toBeNull()
    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('leaves a card that was already open exactly as it was', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    service.open.value = id
    await service.collapse(id)

    expect(service.open.value).toBe(id)
  })

  /**
   * The card decides between a thread and a read-only summary on `session.kind`, and it reads
   * it inside a computed. A plain field would leave the card showing whatever it was showing
   * when it was mounted: a live composer over a conversation that has moved to the sidebar,
   * and — coming back — a read-only summary of a comment that is answering again.
   */
  it('is a change the card can see, both ways', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const promoted = computed(() => session.kind === 'chat')

    expect(promoted.value).toBe(false)

    await service.expand(id)
    expect(promoted.value).toBe(true)

    await service.collapse(id)
    expect(promoted.value).toBe(false)
  })

  it('does nothing for a comment that was never expanded', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    expect(await service.collapse(id)).toBe(false)

    expect(session.kind).toBe('comment')
    expect(service.open.value).toBeNull()
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

    expect(await service.expand(id)).toBe(false)

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

    expect(await service.expand(id)).toBe(false)

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

  it('is not sent back to the margin while the answer is still arriving', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const chatService = ChatService.getInstance()

    await service.expand(id)
    const messages = session.allMessages.value.length
    session.isStreaming.value = true

    expect(await service.collapse(id)).toBe(false)

    expect(session.kind).toBe('chat')
    expect(session.agentId.value).toBe(AgentRegistry.getInstance().defaultAgent()?.id)
    expect(session.allMessages.value).toHaveLength(messages)
    expect(service.sessions.has(id)).toBe(false)
    expect(chatService.getSessionByFile(service.commentPath(id)) === session).toBe(true)
    expect(AbeleConfig.getInstance().ai.chatHistory.map((e) => e.path)).toEqual([
      service.commentPath(id),
    ])
  })

  it('is not sent back to the margin while a tool call is waiting', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    session.pendingToolCalls.value = A_TOOL_CALL

    expect(await service.collapse(id)).toBe(false)

    expect(session.kind).toBe('chat')
    expect(ChatService.getInstance().getSessionByFile(service.commentPath(id)) === session).toBe(
      true
    )
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

  it('leaves the chat a chat when sending it back cannot be written', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const chatService = ChatService.getInstance()

    await service.expand(id)
    const tabs = [...chatService.tabOrder.value]
    refuseToSave(session)

    await expect(service.collapse(id)).rejects.toThrow('disk full')

    expect(session.kind).toBe('chat')
    expect(session.agentId.value).toBe(AgentRegistry.getInstance().defaultAgent()?.id)
    expect(service.sessions.has(id)).toBe(false)
    expect(service.sessionFor(id) === session).toBe(true)
    expect(chatService.tabOrder.value).toEqual(tabs)
    expect(chatService.getSessionByFile(service.commentPath(id)) === session).toBe(true)
    expect(AbeleConfig.getInstance().ai.chatHistory.map((e) => e.path)).toEqual([
      service.commentPath(id),
    ])
  })

  /** Nothing about the failed move is said in the conversation: the log only ever appends. */
  it('leaves no divider behind for a switch that was undone', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    const messages = session.allMessages.value.length
    refuseToSave(session)

    await expect(service.collapse(id)).rejects.toThrow('disk full')

    expect(session.allMessages.value).toHaveLength(messages)
  })

  /**
   * The binding drops the per-chat overrides, because they were expressed against the agent
   * being left. A move that was undone left no agent, so they are somebody's settings still.
   */
  it('gives back the per-chat overrides the binding dropped', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    session.activeModelId.value = 'chosen-by-hand'
    session.applyScope([{ type: 'file', path: 'Notes/A.md' }])
    const overrides = { ...session.overrides.value }
    refuseToSave(session)

    await expect(service.collapse(id)).rejects.toThrow('disk full')

    expect(session.overrides.value).toEqual(overrides)
    expect(session.activeModelId.value).toBe('chosen-by-hand')
    // The resolver, not only the record of it: the binding applied the agent's scope over this
    // one on its way past, so putting the override back has to put the resolver back with it.
    expect(session.scopeResolver.entries.value).toEqual([{ type: 'file', path: 'Notes/A.md' }])
  })
})

/**
 * A vault where the comment agent *is* the default agent.
 *
 * Both moves rebind the agent, and both used to write the divider that records a switch even
 * when there was nothing to switch to — so a round trip left two "Agent: X" lines in a
 * conversation nobody had moved between agents at all.
 */
describe('a comment on the same agent it would be moved to', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().ai.commentAgentId = AgentRegistry.getInstance().defaultAgent()!.id
  })

  it('says nothing about an agent that did not change, either way', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    const before = session.allMessages.value.length

    await service.expand(id)
    await service.collapse(id)

    expect(session.allMessages.value).toHaveLength(before)
    expect(session.allMessages.value.some((m) => m.role === 'system')).toBe(false)
  })

  /** The move itself is unaffected; only the note about it goes. */
  it('still moves the comment there and back', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    expect(await service.expand(id)).toBe(true)
    expect(session.kind).toBe('chat')

    expect(await service.collapse(id)).toBe(true)
    expect(session.kind).toBe('comment')
    expect(service.sessions.get(id) === session).toBe(true)
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
    expect(await service.expand(id)).toBe(false)
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])

    release()
    expect(await first).toBe(true)
    expect(session.moving.value).toBe(false)
    expect(AbeleConfig.getInstance().ai.chatHistory).toHaveLength(1)
  })

  it('refuses a second return to the margin while the first is still writing', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!

    await service.expand(id)
    const release = hangingSave(session)

    const first = service.collapse(id)
    await nextTick()

    expect(session.moving.value).toBe(true)
    expect(await service.collapse(id)).toBe(false)
    expect(service.sessions.has(id)).toBe(false)

    release()
    expect(await first).toBe(true)
    expect(session.moving.value).toBe(false)
    expect(service.sessions.get(id) === session).toBe(true)
  })

  it('is on its way again once a failed move has let go', async () => {
    const service = CommentService.getInstance()
    const session = await answeredComment()
    const id = session.commentId!
    vi.spyOn(session, 'save').mockRejectedValueOnce(new Error('disk full'))

    await expect(service.expand(id)).rejects.toThrow('disk full')

    expect(session.moving.value).toBe(false)
    expect(await service.expand(id)).toBe(true)
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

describe('a comment where the margin has no room for it', () => {
  const hostFor = (ids: string[]) =>
    new CommentEntry({ id: 'vue-1', ids, notePath: 'Notes/A.md', markerFrom: SELECTION_END })

  const shown = async () => {
    const service = CommentService.getInstance()
    const session = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const id = session.commentId as string
    return { service, session, id }
  }

  it('leaves the card in the margin when the pane has room for one', async () => {
    const { service, id } = await shown()
    GlobalStore.getInstance().commentsContainers.value = [hostFor([id])]

    service.openFrom([id], true)

    expect(service.open.value).toBe(id)
    expect(ChatService.getInstance().getAllSessions()).toEqual([])
  })

  /**
   * A phone, and a split too narrow for a sidenote. There is no second implementation of a
   * conversation to open here: the sidebar's own chat view is full-screen on a phone and has
   * the composer, the dictation, the approvals and the message list already.
   */
  it('shows it in the sidebar when there is nowhere to hang a card', async () => {
    const { service, session, id } = await shown()
    const reveal = vi.spyOn(ChatService.getInstance(), 'revealSidebar')

    service.openFrom([id], false)
    await flush()

    expect(ChatService.getInstance().getSession(session.id)).toBe(session)
    expect(reveal).toHaveBeenCalled()
    // The margin is left alone: the conversation is on screen somewhere else entirely.
    expect(service.open.value).toBeNull()
  })

  /**
   * A tab, and nothing else about it changed. This is the whole point of the third bucket: a
   * comment being read in the sidebar is still a comment — same agent, same file, same kind,
   * and no entry in a history that lists the conversations somebody goes looking for.
   */
  it('keeps it a comment: the kind, the maps and the history are untouched', async () => {
    const { service, session, id } = await shown()

    await service.showInSidebar(id)

    expect(session.kind).toBe('comment')
    expect(service.sessionFor(id)).toBe(session)
    expect(service.sessions.get(id)).toBe(session)
    expect(AbeleConfig.getInstance().ai.chatHistory).toEqual([])
  })

  it('repaints the marker, which is drawn from the note it is anchored in', async () => {
    const { service, id } = await shown()
    vi.mocked(dispatchCommentsChanged).mockClear()

    await service.showInSidebar(id)

    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('does not open a second tab for a comment already in one', async () => {
    const { service, id } = await shown()

    await service.showInSidebar(id)
    await service.showInSidebar(id)

    expect(ChatService.getInstance().tabOrder.value).toHaveLength(1)
  })

  /**
   * One comment in the sidebar at a time.
   *
   * The tab strip is hidden on a phone, so a second marker tapped there would stack a tab
   * nobody can see or reach — and go on stacking, past the limit `adoptSession` does not
   * apply. The one before it is handed back the way closing its tab would: alive, on the
   * margin, still writing the same file.
   */
  it('hands the comment it was showing back before it shows another', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const second = await service.create(noteFile(), 6, undefined)
    const chats = ChatService.getInstance()

    await service.showInSidebar(first.commentId as string)
    await service.showInSidebar(second.commentId as string)

    expect(chats.getSession(second.id)).toBe(second)
    expect(chats.getSession(first.id)).toBeNull()
    expect(first.isDestroyed).toBe(false)
    expect(service.sessionFor(first.commentId as string)).toBe(first)
    expect(service.isShown(first.commentId as string)).toBe(false)
  })

  it('leaves one comment tab behind after two taps, not two', async () => {
    const service = CommentService.getInstance()
    const first = await service.create(noteFile(), SELECTION_END, 'The selected passage')
    const second = await service.create(noteFile(), 6, undefined)

    service.openFrom([first.commentId as string], false)
    await flush()
    service.openFrom([second.commentId as string], false)
    await flush()

    const commentTabs = ChatService.getInstance()
      .getAllSessions()
      .filter((session) => session.kind === 'comment')
    expect(commentTabs).toEqual([second])
  })

  /**
   * The limit applies here too. It used to be waived for an adopted session, which on a phone
   * — where the strip is hidden — meant piling up tabs nobody could see or close.
   */
  it('refuses a tab when the bar is already full, and says so', async () => {
    const { service, session, id } = await shown()
    const chats = ChatService.getInstance()
    for (let i = 0; i < 8; i++) chats.createTab()
    Notice.shown.length = 0

    expect(await service.showInSidebar(id)).toBe(false)

    expect(chats.getSession(session.id)).toBeNull()
    expect(service.isShown(id)).toBe(false)
    expect(Notice.shown.join(' ')).toContain('8 open tabs')
  })

  /** An expanded comment is a chat and is not handed back: it owns its tab like any other. */
  it('leaves an expanded comment where it is when another is shown', async () => {
    const service = CommentService.getInstance()
    const first = await answeredComment()
    const second = await service.create(noteFile(), 6, undefined)

    await service.expand(first.commentId as string)
    await service.showInSidebar(second.commentId as string)

    expect(ChatService.getInstance().getSession(first.id)).toBe(first)
  })

  /**
   * Closing the tab is not ending the conversation: the same session goes on writing the same
   * file from the margin, which is what the reader comes back to on a wider screen.
   */
  it('hands the session back alive when its tab is closed', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)

    await ChatService.getInstance().closeTab(session.id)

    expect(session.isDestroyed).toBe(false)
    expect(service.sessionFor(id)).toBe(session)
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
  })

  it('repaints the marker on the way back out of the sidebar', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)
    vi.mocked(dispatchCommentsChanged).mockClear()

    await ChatService.getInstance().closeTab(session.id)

    expect(vi.mocked(dispatchCommentsChanged).mock.calls.flat()).toContain('Notes/A.md')
  })

  it('deletes a shown comment, its tab and its file together', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)

    await service.remove(id)

    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
    expect(app.vault.getAbstractFileByPath(service.commentPath(id))).toBeNull()
    expect(await noteText()).toBe(NOTE)
  })

  /**
   * "Open as chat" from the sidebar: the tab it is already in becomes the chat's tab. A second
   * one would be the same file open twice, with two log writers on it.
   */
  it('expands in place, without a second tab', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)

    expect(await service.expand(id)).toBe(true)

    expect(session.kind).toBe('chat')
    expect(ChatService.getInstance().tabOrder.value).toEqual([session.id])
    expect(service.sessions.has(id)).toBe(false)
  })

  /** And back again, which must not leave the id marked as shown in a tab it no longer has. */
  it('collapses out of an expanded comment without leaving a tab behind', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)
    await service.expand(id)

    expect(await service.collapse(id)).toBe(true)

    expect(session.kind).toBe('comment')
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
    expect(service.sessions.get(id)).toBe(session)
  })

  /**
   * Not the refusal `expand` and `collapse` make.
   *
   * Those rewrite what the file says the conversation is and rebind its agent, neither of which
   * may happen between a `tool_use` and its result. Showing it in a tab rewrites nothing at all
   * — and a marker tapped while the agent is working is a person who wants to watch the answer
   * arrive, which on a phone this is the only way to do.
   */
  it('shows a comment whose agent is mid-turn, and lets the turn go on', async () => {
    const { service, session, id } = await shown()
    session.isStreaming.value = true

    expect(await service.showInSidebar(id)).toBe(true)

    expect(ChatService.getInstance().getSession(session.id)).toBe(session)
    expect(session.isStreaming.value).toBe(true)
    expect(session.commentState.value).toBe('busy')
  })

  it('shows one waiting on an approval too', async () => {
    const { service, session, id } = await shown()
    session.pendingToolCalls.value = [{ id: 'tc1', name: 'read_note', input: {} }] as never

    expect(await service.showInSidebar(id)).toBe(true)
    expect(ChatService.getInstance().getSession(session.id)).toBe(session)
  })

  /** And out again: the tab goes, the turn does not. */
  it('hands a streaming comment back alive when its tab is closed', async () => {
    const { service, session, id } = await shown()
    await service.showInSidebar(id)
    session.isStreaming.value = true

    await ChatService.getInstance().closeTab(session.id)

    expect(session.isDestroyed).toBe(false)
    expect(service.sessionFor(id)).toBe(session)
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
    // The marker draws itself from this, and it must go on saying the agent is working.
    expect(service.get(id)?.state).toBe('busy')
  })

  it('refuses while the comment is already being moved', async () => {
    const { service, session, id } = await shown()
    session.moving.value = true

    expect(await service.showInSidebar(id)).toBe(false)
    expect(ChatService.getInstance().getSession(session.id)).toBeNull()
  })

  /**
   * The hosts belong to live-preview views and are dropped when one closes; the comment is
   * still loadable from its file, which is all the sidebar needs.
   */
  it('opens a comment the margin has no host for', async () => {
    const { service, session, id } = await shown()
    GlobalStore.getInstance().commentsContainers.value = []

    service.openFrom([id], false)
    await flush()

    expect(ChatService.getInstance().getSession(session.id)).toBe(session)
  })

  it('does nothing at all for an id nothing knows about', async () => {
    const service = CommentService.getInstance()

    service.openFrom(['zzz999'], false)
    await flush()

    expect(ChatService.getInstance().getAllSessions()).toEqual([])
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
