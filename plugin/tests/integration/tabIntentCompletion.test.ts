import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatService, MAX_TABS } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentsService } from '@/agents/AgentsService'
import { ChatLink } from '@/entities/ChatLink'
import { attachNoteToChat } from '@/commands/attachChat'
import { pickChat } from '@/helpers/suggesters/ChatPicker'
import { AbeleConfig } from '@/services/AbeleConfig'
import { serializeChat, parseChatMetadata } from '@/ai/ChatLog'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

vi.mock('@/editor/CommentPlugin', () => ({ dispatchCommentsChanged: vi.fn() }))
vi.mock('@/helpers/suggesters/ChatPicker', () => ({ pickChat: vi.fn() }))

const a = 'AI/Chats/sample-card.abchat'
const b = 'AI/Chats/sample-other.abchat'
const discussion = 'AI/Comments/sample-context.abchat'
const discussionId = 'sample-context'
const content = (extra: Partial<ChatMetadata> = {}) => serializeChat({
  metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '', ...extra },
  messages: [],
  internalMessages: [],
})
const discussionContent = () => content({
  kind: 'comment', commentId: discussionId, commentLocation: discussion,
  anchor: { note: 'Notes/sample-source.md' },
})

/** Real ChatService reveal and adapter; only the workspace boundary is fake. */
function fixture() {
  const app = useVault([
    { path: a, content: content({ attention: { tools: { 'sample-call': 'executing' } } }) },
    { path: b, content: content() },
    { path: discussion, content: discussionContent() },
    { path: 'Notes/sample-source.md', content: 'Sample source text' },
  ])
  const rightSplit = { collapsed: true, expand: vi.fn(() => { rightSplit.collapsed = false }) }
  const leftSplit = { collapsed: true }
  const leaf = {
    getRoot: () => rightSplit,
    view: { containerEl: { isShown: () => !rightSplit.collapsed } },
    setViewState: vi.fn().mockResolvedValue(undefined),
  }
  const workspace = {
    rightSplit, leftSplit,
    getLeavesOfType: () => [leaf],
    getRightLeaf: () => leaf,
    revealLeaf: vi.fn().mockResolvedValue(undefined),
  }
  Object.assign(app, { workspace })
  Object.assign(app.metadataCache, { fileToLinktext: (file: TFile) => file.basename })
  return { app, workspace }
}

beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

describe('tab intent completion boundaries', () => {
  it.each(['card', 'attention', 'attachment'] as const)(
    'an older %s open cannot admit a new foreground intent while revealing',
    async (entry) => {
      const { app, workspace } = fixture()
      const chats = ChatService.getInstance(), comments = CommentService.getInstance()
      const agents = AgentsService.getInstance()
      await agents.start()
      await chats.openChatFile(app.vault.getFileByPath(a)!)
      const previous = chats.activeSession.value!
      const readGate = deferred(), reading = deferred()
      const prepareGate = deferred(), preparing = deferred()
      const reconcile = previous.reconcileForSelectionReturn.bind(previous)
      vi.spyOn(previous, 'reconcileForSelectionReturn').mockImplementationOnce(async (...args) => {
        reading.resolve(); await readGate.promise; return reconcile(...args)
      })
      const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
      let paused = false
      vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
        if (args[0].path === discussion && !paused) {
          paused = true; preparing.resolve(); await prepareGate.promise
        }
        return prepare(...args)
      })
      const row = agents.rows.value.find((row) => row.reference.kind === 'local' && row.reference.path === a)!
      vi.mocked(pickChat).mockResolvedValue(app.vault.getFileByPath(a)!)
      const older = entry === 'card'
        ? new ChatLink({ path: a, title: 'Sample card', created: '' }, 'Notes/sample-source.md').open()
        : entry === 'attachment'
          ? attachNoteToChat(app.vault.getFileByPath('Notes/sample-source.md')!)
          : agents.open(row, row.reasons[0])
      await reading.promise
      const latest = comments.showInSidebar(discussionId)
      await preparing.promise
      readGate.resolve()
      const olderResult = await older
      const staleReveals = workspace.revealLeaf.mock.calls.length
      prepareGate.resolve()
      expect(await latest).toBe(true)
      if (entry !== 'card') expect(olderResult).toBe(false)
      expect(staleReveals).toBe(0)
      expect(workspace.revealLeaf).toHaveBeenCalledOnce()
      expect(chats.activeSession.value?.commentId).toBe(discussionId)
      expect(comments.isShown(discussionId)).toBe(true)
      expect(chats.getSession(previous.id)).toBe(previous)
    }
  )

  it('an unscoped reveal continuation cannot replace an already admitted opening intent', async () => {
    const { app } = fixture()
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(a)!)
    const gate = deferred(), preparing = deferred()
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
    vi.spyOn(storage, 'prepareDiscussion').mockImplementationOnce(async (...args) => {
      preparing.resolve(); await gate.promise; return prepare(...args)
    })
    const latest = comments.showInSidebar(discussionId)
    await preparing.promise
    await chats.revealSidebar()
    gate.resolve()
    expect(await latest).toBe(true)
    expect(chats.activeSession.value?.commentId).toBe(discussionId)
  })

  it.each((['chat', 'comment'] as const).flatMap((kind) =>
    (['close', 'switch'] as const).map((action) => [kind, action] as const)
  ))('a pending %s close survives an independent %s on another tab', async (kind, action) => {
    const { app } = fixture()
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const path = kind === 'chat' ? a : discussion
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const first = chats.activeSession.value!
    await chats.openChatFile(app.vault.getFileByPath(b)!)
    const second = chats.activeSession.value!
    first.chatTitle.value = 'A buffered sample title'
    const gate = deferred(), saving = deferred()
    const storage = ChatStorage.getInstance(), save = storage.saveChat.bind(storage)
    let paused = false
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === path && !paused) {
        paused = true; saving.resolve(); await gate.promise
      }
      return save(...args)
    })
    const closing = chats.closeTab(first.id)
    await saving.promise
    if (action === 'close') await chats.closeTab(second.id)
    else chats.switchTab(second.id)
    gate.resolve()
    await closing
    expect(chats.getSession(first.id)).toBeNull()
    expect(first.isDestroyed).toBe(kind === 'chat')
    if (kind === 'comment') expect(comments.isShown(discussionId)).toBe(false)
    if (action === 'close') expect(chats.getSession(second.id)).toBeNull()
    else expect(chats.activeSession.value).toBe(second)
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))?.title)
      .toBe('A buffered sample title')
  })

  it.each(['chat', 'comment'] as const)('reopening the same %s target still supersedes its pending close', async (kind) => {
    const { app } = fixture()
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const path = kind === 'chat' ? a : discussion
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    session.chatTitle.value = 'A buffered sample title'
    const gate = deferred(), saving = deferred()
    const storage = ChatStorage.getInstance(), save = storage.saveChat.bind(storage)
    let paused = false
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === path && !paused) {
        paused = true; saving.resolve(); await gate.promise
      }
      return save(...args)
    })
    const closing = chats.closeTab(session.id)
    await saving.promise
    chats.switchTab(session.id)
    gate.resolve()
    await closing
    expect(chats.getSession(session.id)).toBe(session)
    expect(session.isDestroyed).toBe(false)
    if (kind === 'comment') expect(comments.isShown(discussionId)).toBe(true)
  })

  it('reentrant expansion explicitly refuses admission without queuing an orphaned reservation', async () => {
    fixture()
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    for (let index = 0; index < MAX_TABS - 1; index++) {
      chats.getSession(chats.createTab())!.draft.value.text = `A retained sample draft ${index}`
    }
    const session = (await comments.load(discussionId))!
    let expanding!: Promise<unknown>
    chats.mutatePresentation(() => { expanding = comments.expand(discussionId) })
    const outcome = await expanding.then((result) => ({ result }), (error: unknown) => ({ error }))
    expect(chats.canCreateTab).toBe(true)
    expect(outcome).toMatchObject({ error: expect.any(Error) })
    expect(outcome).toMatchObject({ error: { message: expect.stringContaining('cannot run inside') } })
    expect(session.kind).toBe('comment')
    expect(comments.isExpanded(discussionId)).toBe(false)
    expect(chats.tabOrder.value).toHaveLength(MAX_TABS - 1)
    expect(await comments.expand(discussionId)).toBe('moved')
    expect(chats.activeSession.value).toBe(session)
    expect(chats.tabOrder.value).toHaveLength(MAX_TABS)
  })

  it.each(['chat', 'comment'] as const)('a real write failure refuses %s close and a later retry succeeds', async (kind) => {
    const { app } = fixture()
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const path = kind === 'chat' ? a : discussion
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    session.chatTitle.value = 'An unsaved sample title'
    const writing = vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockRejectedValue(new Error('Sample write failure'))
    const closing = chats.closeTab(session.id)
    const outcome = await closing.then(() => ({ closed: true }), (error: unknown) => ({ error }))
    writing.mockRestore()
    expect(outcome).toMatchObject({ error: expect.any(Error) })
    expect(chats.getSession(session.id)).toBe(session)
    expect(session.isDestroyed).toBe(false)
    expect(session.chatTitle.value).toBe('An unsaved sample title')
    if (kind === 'comment') expect(comments.isShown(discussionId)).toBe(true)
    await chats.closeTab(session.id)
    expect(chats.getSession(session.id)).toBeNull()
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))?.title)
      .toBe('An unsaved sample title')
  })
})
