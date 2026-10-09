import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService, MAX_TABS } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { openChat, openSelectionLink } from '@/ai/openChat'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { captureChatSelection, createChatAnchor } from '@/selection/anchors'
import { useVault } from '../helpers/testEnv'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))
const x = 'AI/Comments/sample-x.abchat'
const y = 'AI/Comments/sample-y.abchat'
const xId = 'sample-discussion-x'
const yId = 'sample-discussion-y'
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function content(path: string, id: string, selection = false) {
  const revision = {
    reference: {
      chatId: path === x ? 'sample-chat-x' : 'sample-chat-y',
      messageId: 'sample-reply',
      revisionId: 'sample-revision',
    },
    content: 'alpha beta',
    projection: { version: 'chat-text-v1', text: 'alpha beta' },
  }
  const anchors = [
    ['sample-anchor-a', 0, 5],
    ['sample-anchor-b', 6, 10],
  ].map(([id, start, end]) => {
    const captured = captureChatSelection({
      revision,
      range: { space: 'rendered', start: start as number, end: end as number },
      role: 'assistant',
      author: 'assistant',
      title: 'Sample',
      pathHint: path,
      sentence: revision.content,
    })
    return createChatAnchor(captured, revision, () => id as string)
  })
  return serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: '',
      modelId: '',
      created: '',
      kind: 'comment',
      commentId: id,
      commentLocation: path,
      anchor: { note: 'Notes/sample.md' },
      chatId: selection ? revision.reference.chatId : undefined,
    },
    messages: selection
      ? [
          {
            id: 'sample-reply',
            role: 'assistant',
            content: revision.content,
            timestamp: 1,
            selection: { revisionId: 'sample-revision', versions: [revision], anchors },
          },
        ]
      : [],
    internalMessages: [],
  })
}
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

describe('request-local contextual opening', () => {
  it.each([false, true])(
    'parallel file-link opens leave no contextual request behind for a later attention open (expired guard: %s)',
    async (guarded) => {
      const app = useVault([
        { path: x, content: content(x, xId) },
        { path: y, content: content(y, yId) },
      ])
      const file = app.vault.getFileByPath(x)!
      const gate = deferred()
      const reached = deferred()
      const storage = ChatStorage.getInstance()
      const prepare = storage.prepareDiscussion.bind(storage)
      vi.spyOn(storage, 'prepareDiscussion').mockImplementationOnce(async (...args) => {
        reached.resolve()
        await gate.promise
        return prepare(...args)
      })
      let current = true
      const isCurrent = guarded ? () => current : undefined
      const first = openChat(file, isCurrent)
      await reached.promise
      const second = openChat(file, isCurrent)
      gate.resolve()
      await Promise.all([first, second])
      current = false
      const chats = ChatService.getInstance()
      const comments = CommentService.getInstance()
      const ownerX = chats.activeSession.value!
      await chats.closeTab(ownerX.id)
      await openChat(app.vault.getFileByPath(y)!)
      const ownerY = chats.activeSession.value!
      expect(comments.isShown(yId)).toBe(true)
      expect(await comments.revealForAttention(file)).toBe(true)
      expect(chats.activeSession.value?.currentChatFile.value?.path).toBe(x)
      expect(chats.getSession(ownerY.id)).toBe(ownerY)
      expect(comments.isShown(yId)).toBe(true)
      expect(ownerY.isDestroyed).toBe(false)
      expect(chats.tabOrder.value).toContain(ownerY.id)
      expect(chats.tabOrder.value).toContain(ownerX.id)
      expect(parseChatMetadata(await app.vault.read(file))?.commentId).toBe(xId)
    }
  )

  it('a newer selection link back to a contextual tab supersedes its delayed release', async () => {
    const app = useVault([
      { path: x, content: content(x, xId, true) },
      { path: y, content: content(y, yId, true) },
    ])
    const comments = CommentService.getInstance()
    const chats = ChatService.getInstance()
    await comments.showInSidebar(yId)
    const ownerY = chats.activeSession.value!
    ownerY.chatTitle.value = 'A pending local title'
    ownerY.draft.value.text = 'An unsent sample thought'
    const draft = ownerY.draft.value
    ownerY.isStreaming.value = true
    const gate = deferred()
    const saving = deferred()
    const reopening = deferred()
    const storage = ChatStorage.getInstance()
    const save = storage.saveChat.bind(storage)
    let paused = false
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === y && !paused) {
        paused = true
        saving.resolve()
        await gate.promise
      }
      return save(...args)
    })
    const reconcile = ownerY.reconcileForSelectionReturn.bind(ownerY)
    vi.spyOn(ownerY, 'reconcileForSelectionReturn').mockImplementation((...args) => {
      const task = reconcile(...args)
      reopening.resolve()
      return task
    })
    const stale = openSelectionLink(`${x}#abele-selection=sample-chat-x/sample-anchor-a`)
    await saving.promise
    const current = openSelectionLink(`${y}#abele-selection=sample-chat-y/sample-anchor-b`)
    await reopening.promise
    gate.resolve()
    await Promise.all([stale, current])
    expect(chats.activeSession.value).toBe(ownerY)
    expect(chats.getSession(ownerY.id)).toBe(ownerY)
    expect(chats.tabOrder.value.filter((id) => id === ownerY.id)).toHaveLength(1)
    expect(comments.isShown(yId)).toBe(true)
    expect(ownerY.isDestroyed).toBe(false)
    expect(ownerY.isStreaming.value).toBe(true)
    expect(ownerY.draft.value).toBe(draft)
    expect(ownerY.draft.value.text).toBe('An unsent sample thought')
    expect(chats.pendingAnchorReturn.value?.sessionId).toBe(ownerY.id)
    expect(chats.pendingAnchorReturn.value?.target.anchor.id).toBe('sample-anchor-b')
    expect(chats.openingSelection.value).toBe(false)
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(y)!))).toMatchObject({
      commentId: yId,
      commentLocation: y,
      title: 'A pending local title',
    })
  })

  it.each(['selection', 'attention'] as const)(
    'a plain link stops after its contextual release is superseded by %s reopening',
    async (reopen) => {
      const app = useVault([
        { path: x, content: content(x, xId, true) },
        { path: y, content: content(y, yId, true) },
      ])
      const comments = CommentService.getInstance()
      const chats = ChatService.getInstance()
      await comments.showInSidebar(yId)
      const ownerY = chats.activeSession.value!
      ownerY.chatTitle.value = 'A pending local title'
      ownerY.draft.value.text = 'A retained sample draft'
      const draft = ownerY.draft.value
      const saveGate = deferred()
      const saving = deferred()
      const reopening = deferred()
      const readGate = deferred()
      const reading = deferred()
      const storage = ChatStorage.getInstance()
      const save = storage.saveChat.bind(storage)
      let savingPaused = false
      let saved = false
      vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
        if (args[2]?.path === y && !savingPaused) {
          savingPaused = true
          saving.resolve()
          await saveGate.promise
          const result = await save(...args)
          saved = true
          return result
        }
        return save(...args)
      })
      const read = app.vault.read.bind(app.vault)
      let readingPaused = false
      vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
        if (file.path === y && saved && !readingPaused) {
          readingPaused = true
          reading.resolve()
          await readGate.promise
        }
        return read(file)
      })
      const reconcile = ownerY.reconcileForSelectionReturn.bind(ownerY)
      vi.spyOn(ownerY, 'reconcileForSelectionReturn').mockImplementation((...args) => {
        const result = reconcile(...args)
        reopening.resolve()
        return result
      })
      const saveCalls = vi.mocked(storage.saveChat)
      const stale = openChat(app.vault.getFileByPath(x)!)
      await saving.promise
      const current =
        reopen === 'selection'
          ? openSelectionLink(`${y}#abele-selection=sample-chat-y/sample-anchor-b`)
          : comments.revealForAttention(app.vault.getFileByPath(y)!)
      await reopening.promise
      saveGate.resolve()
      await reading.promise
      // The old link may finish its save, but cannot retry the presentation transaction
      // while the newer Y reconciliation is still suspended. Exactly one save was needed.
      await stale
      expect(saveCalls.mock.calls.filter(([, , file]) => file?.path === y)).toHaveLength(1)
      expect(chats.getSession(ownerY.id)).toBe(ownerY)
      expect(chats.getSessionByFile(x)).toBeNull()
      expect(comments.isShown(xId)).toBe(false)
      readGate.resolve()
      const result = await current
      if (reopen === 'attention') expect(result).toBe(true)
      expect(chats.activeSession.value).toBe(ownerY)
      expect(chats.getSession(ownerY.id)).toBe(ownerY)
      expect(chats.tabOrder.value.filter((id) => id === ownerY.id)).toHaveLength(1)
      expect(comments.isShown(yId)).toBe(true)
      expect(ownerY.isDestroyed).toBe(false)
      expect(ownerY.draft.value).toBe(draft)
      expect(ownerY.draft.value.text).toBe('A retained sample draft')
      if (reopen === 'selection') {
        expect(chats.pendingAnchorReturn.value?.sessionId).toBe(ownerY.id)
        expect(chats.pendingAnchorReturn.value?.target.anchor.id).toBe('sample-anchor-b')
      }
      expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(y)!))).toMatchObject({
        commentId: yId,
        commentLocation: y,
        title: 'A pending local title',
      })
    }
  )

  async function exerciseReleaseCohort(
    join: 'plain' | 'selection',
    timing: 'before release' | 'during release',
    reopen: 'plain' | 'selection' | 'attention' | 'marker'
  ) {
    const app = useVault([
      { path: x, content: content(x, xId, true) },
      { path: y, content: content(y, yId, true) },
    ])
    const comments = CommentService.getInstance()
    const chats = ChatService.getInstance()
    await comments.showInSidebar(yId)
    const ownerY = chats.activeSession.value!
    ownerY.chatTitle.value = 'A pending cohort title'
    ownerY.draft.value.text = 'A preserved cohort draft'
    const draft = ownerY.draft.value
    ownerY.isStreaming.value = true
    const saveGate = deferred(),
      saving = deferred(),
      reopening = deferred()
    const readGate = deferred(),
      reading = deferred()
    const prepareGate = deferred(),
      preparing = deferred(),
      joined = deferred()
    const storage = ChatStorage.getInstance()
    const save = storage.saveChat.bind(storage)
    let saved = false,
      savingPaused = false
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === y && !savingPaused) {
        savingPaused = true
        saving.resolve()
        await saveGate.promise
        const result = await save(...args)
        saved = true
        return result
      }
      return save(...args)
    })
    const prepare = storage.prepareDiscussion.bind(storage)
    let preparePaused = false
    vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
      if (timing === 'before release' && args[0].path === x && !preparePaused) {
        preparePaused = true
        preparing.resolve()
        await prepareGate.promise
      }
      return prepare(...args)
    })
    const read = app.vault.read.bind(app.vault)
    let readPaused = false
    vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
      if (file.path === y && saved && !readPaused) {
        readPaused = true
        reading.resolve()
        await readGate.promise
      }
      return read(file)
    })
    const reconcile = ownerY.reconcileForSelectionReturn.bind(ownerY)
    vi.spyOn(ownerY, 'reconcileForSelectionReturn').mockImplementation((...args) => {
      const task = reconcile(...args)
      reopening.resolve()
      return task
    })
    const dispatch = chats.openContextualChatFile.bind(chats)
    let requests = 0
    vi.spyOn(chats, 'openContextualChatFile').mockImplementation((...args) => {
      const task = dispatch(...args)
      if (args[0].path === x && ++requests === 2) joined.resolve()
      return task
    })
    const saveCalls = vi.mocked(storage.saveChat)
    const first = openChat(app.vault.getFileByPath(x)!)
    await (timing === 'before release' ? preparing.promise : saving.promise)
    const second =
      join === 'plain'
        ? openChat(app.vault.getFileByPath(x)!)
        : openSelectionLink(`${x}#abele-selection=sample-chat-x/sample-anchor-a`)
    await joined.promise
    if (timing === 'before release') {
      prepareGate.resolve()
      await saving.promise
    }
    const current =
      reopen === 'selection'
        ? openSelectionLink(`${y}#abele-selection=sample-chat-y/sample-anchor-b`)
        : reopen === 'attention'
          ? comments.revealForAttention(app.vault.getFileByPath(y)!)
          : reopen === 'marker'
            ? comments.showInSidebar(yId)
            : openChat(app.vault.getFileByPath(y)!)
    await reopening.promise
    saveGate.resolve()
    await reading.promise
    await Promise.all([first, second])
    // Shared waiters can plan together, but save only once and never commit a stale release.
    expect(saveCalls.mock.calls.filter(([, , file]) => file?.path === y)).toHaveLength(1)
    expect(chats.getSession(ownerY.id)).toBe(ownerY)
    expect(chats.getSessionByFile(x)).toBeNull()
    expect(comments.isShown(xId)).toBe(false)
    readGate.resolve()
    const result = await current
    if (reopen === 'attention' || reopen === 'marker') expect(result).toBe(true)
    expect(chats.activeSession.value).toBe(ownerY)
    expect(chats.getSession(ownerY.id)).toBe(ownerY)
    expect(chats.tabOrder.value.filter((id) => id === ownerY.id)).toHaveLength(1)
    expect(comments.isShown(yId)).toBe(true)
    expect(ownerY.isDestroyed).toBe(false)
    expect(ownerY.isStreaming.value).toBe(true)
    expect(ownerY.draft.value).toBe(draft)
    if (reopen === 'selection') {
      expect(chats.pendingAnchorReturn.value?.sessionId).toBe(ownerY.id)
      expect(chats.pendingAnchorReturn.value?.target.anchor.id).toBe('sample-anchor-b')
    }
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(y)!))).toMatchObject({
      commentId: yId,
      commentLocation: y,
      title: 'A pending cohort title',
    })
  }

  it('a late plain-link joiner cannot restart release after a newer attention reopen', async () => {
    await exerciseReleaseCohort('plain', 'during release', 'attention')
  })
  it.each(
    (['plain', 'selection'] as const).flatMap((join) =>
      (['before release', 'during release'] as const).flatMap((timing) =>
        (['plain', 'selection', 'attention', 'marker'] as const).map(
          (reopen) => [join, timing, reopen] as const
        )
      )
    )
  )(
    'session reopen supersedes %s joiners %s through the %s opener',
    async (join, timing, reopen) => {
      await exerciseReleaseCohort(join, timing, reopen)
    }
  )

  it('a contextual tab appearing during older preparation is protected by its later reopen', async () => {
    const app = useVault([{ path: x, content: content(x, xId, true) }, { path: y, content: content(y, yId, true) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const prepareGate = deferred(), preparing = deferred(), saveGate = deferred(), saving = deferred(), reopening = deferred()
    const readGate = deferred(), reading = deferred()
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage), save = storage.saveChat.bind(storage)
    let preparePaused = false, savePaused = false, saved = false, readPaused = false
    vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
      if (args[0].path === x && !preparePaused) { preparePaused = true; preparing.resolve(); await prepareGate.promise }
      return prepare(...args)
    })
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === y && !savePaused) {
        savePaused = true; saving.resolve(); await saveGate.promise
        const result = await save(...args); saved = true; return result
      }
      return save(...args)
    })
    const read = app.vault.read.bind(app.vault)
    vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
      if (file.path === y && saved && !readPaused) { readPaused = true; reading.resolve(); await readGate.promise }
      return read(file)
    })
    const older = openChat(app.vault.getFileByPath(x)!)
    await preparing.promise
    expect(await comments.revealForAttention(app.vault.getFileByPath(y)!)).toBe(true)
    const ownerY = chats.activeSession.value!
    ownerY.chatTitle.value = 'A late contextual tab'
    const reconcile = ownerY.reconcileForSelectionReturn.bind(ownerY)
    vi.spyOn(ownerY, 'reconcileForSelectionReturn').mockImplementation((...args) => {
      const task = reconcile(...args); reopening.resolve(); return task
    })
    prepareGate.resolve()
    // A serial intent implementation can reject the stale X before it even plans a release.
    const phase = await Promise.race([saving.promise.then(() => 'save'), older.then(() => 'done')])
    const latest = openChat(app.vault.getFileByPath(y)!)
    if (phase === 'save') {
      await reopening.promise; saveGate.resolve(); await reading.promise
      await older
      readGate.resolve()
    } else { saveGate.resolve(); readGate.resolve() }
    await Promise.all([older, latest])
    expect(chats.activeSession.value).toBe(ownerY)
    expect(chats.getSession(ownerY.id)).toBe(ownerY)
    expect(comments.isShown(yId)).toBe(true)
    expect(chats.tabOrder.value.filter((id) => id === ownerY.id)).toHaveLength(1)
    expect(ownerY.isDestroyed).toBe(false)
  })

  it('completion of an older reopen does not supersede the newer contextual target', async () => {
    const app = useVault([{ path: x, content: content(x, xId, true) }, { path: y, content: content(y, yId, true) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.showInSidebar(yId)
    const ownerY = chats.activeSession.value!
    const readGate = deferred(), reading = deferred(), prepareGate = deferred(), preparing = deferred()
    const reconcile = ownerY.reconcileForSelectionReturn.bind(ownerY)
    vi.spyOn(ownerY, 'reconcileForSelectionReturn').mockImplementationOnce(async (...args) => {
      reading.resolve(); await readGate.promise; return reconcile(...args)
    })
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
    let paused = false
    vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
      if (args[0].path === x && !paused) { paused = true; preparing.resolve(); await prepareGate.promise }
      return prepare(...args)
    })
    const older = openChat(app.vault.getFileByPath(y)!)
    await reading.promise
    const latest = openChat(app.vault.getFileByPath(x)!)
    await preparing.promise
    readGate.resolve()
    await older
    prepareGate.resolve()
    await latest
    const ownerX = chats.activeSession.value!
    expect(ownerX.currentChatFile.value?.path).toBe(x)
    expect(ownerX.commentId).toBe(xId)
    expect(comments.isShown(xId)).toBe(true)
    expect(comments.isShown(yId)).toBe(false)
    expect(ownerY.isDestroyed).toBe(false)
    expect(chats.tabOrder.value.filter((id) => id === ownerX.id)).toHaveLength(1)
  })

  it('a current joiner replaces the reselected contextual tab at the tab limit', async () => {
    const app = useVault([{ path: x, content: content(x, xId, true) }, { path: y, content: content(y, yId, true) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const ordinary = Array.from({ length: MAX_TABS - 1 }, (_, index) => {
      const session = chats.getSession(chats.createTab())!
      session.draft.value.text = `A preserved draft ${index}`
      return session
    })
    await comments.showInSidebar(yId)
    const ownerY = chats.activeSession.value!
    ownerY.chatTitle.value = 'A pending full-panel title'
    const gate = deferred(), saving = deferred(), joined = deferred()
    const storage = ChatStorage.getInstance(), save = storage.saveChat.bind(storage)
    let paused = false
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      if (args[2]?.path === y && !paused) { paused = true; saving.resolve(); await gate.promise }
      return save(...args)
    })
    const dispatch = chats.openContextualChatFile.bind(chats)
    let requests = 0
    vi.spyOn(chats, 'openContextualChatFile').mockImplementation((...args) => {
      const task = dispatch(...args)
      if (args[0].path === x && ++requests === 2) joined.resolve()
      return task
    })
    const older = openChat(app.vault.getFileByPath(x)!)
    await saving.promise
    chats.switchTab(ownerY.id)
    const latest = openChat(app.vault.getFileByPath(x)!)
    await joined.promise
    gate.resolve()
    await Promise.all([older, latest])
    const ownerX = chats.activeSession.value!
    expect(ownerX.currentChatFile.value?.path).toBe(x)
    expect(ownerX.commentId).toBe(xId)
    expect(chats.tabOrder.value).toHaveLength(MAX_TABS)
    expect(comments.isShown(yId)).toBe(false)
    expect(comments.isShown(xId)).toBe(true)
    expect(ownerY.isDestroyed).toBe(false)
    for (const session of ordinary) expect(chats.getSession(session.id)).toBe(session)
  })

  it('a new blank tab supersedes a contextual open still preparing its file', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const gate = deferred(), preparing = deferred()
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
    vi.spyOn(storage, 'prepareDiscussion').mockImplementationOnce(async (...args) => {
      preparing.resolve(); await gate.promise; return prepare(...args)
    })
    const older = openChat(app.vault.getFileByPath(x)!)
    await preparing.promise
    const blank = chats.newTab()
    gate.resolve()
    await older
    expect(chats.activeTabId.value).toBe(blank)
    expect(chats.getSessionByFile(x)).toBeNull()
    expect(comments.isShown(xId)).toBe(false)
  })

  it.each(['reveal', 'revealChat'] as const)('a delayed %s does not manufacture a newer presentation intent', async (entry) => {
    const app = useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.load(yId)
    if (entry === 'revealChat') await comments.expand(yId)
    const gate = deferred(), loading = deferred(), load = comments.load.bind(comments)
    vi.spyOn(comments, 'load').mockImplementationOnce(async (...args) => {
      loading.resolve(); await gate.promise; return load(...args)
    })
    const older = comments[entry](yId)
    await loading.promise
    await openChat(app.vault.getFileByPath(x)!)
    const latest = chats.activeSession.value
    gate.resolve()
    await older
    expect(chats.activeSession.value).toBe(latest)
    expect(comments.isShown(xId)).toBe(true)
  })

  it('returning to an expanded discussion leaves the contextual discussion registered', async () => {
    useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.load(xId)
    expect(await comments.expand(xId)).toBe('moved')
    const expanded = chats.activeSession.value!
    await comments.showInSidebar(yId)
    const contextual = chats.activeSession.value!
    expect(await comments.showInSidebar(xId)).toBe(true)
    expect(chats.activeSession.value).toBe(expanded)
    expect(chats.getSession(contextual.id)).toBe(contextual)
    expect(comments.isShown(yId)).toBe(true)
    expect(comments.isShown(xId)).toBe(false)
  })

  it('the tab-specific file opener cannot bypass discussion capacity or presentation bookkeeping', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const holder = chats.getSession(chats.createTab())!
    holder.draft.value.text = 'A retained tab draft'
    await chats.openChatInTab(holder.id, app.vault.getFileByPath(y)!)
    const discussion = chats.activeSession.value!
    expect(comments.isShown(yId)).toBe(true)
    while (chats.canCreateTab) chats.createTab()
    await chats.openChatInTab(holder.id, app.vault.getFileByPath(x)!)
    expect(chats.tabOrder.value).toHaveLength(MAX_TABS)
    expect(chats.getSessionByFile(x)).toBeNull()
    expect(chats.getSession(discussion.id)).toBe(discussion)
    expect(holder.draft.value.text).toBe('A retained tab draft')
  })

  it('a selection lookup is admitted before I/O and cannot override a later marker action', async () => {
    useVault([{ path: x, content: content(x, xId, true) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const gate = deferred(), reading = deferred()
    const storage = ChatStorage.getInstance(), index = storage.selectionIdentityIndex.bind(storage)
    vi.spyOn(storage, 'selectionIdentityIndex').mockImplementationOnce(async () => {
      reading.resolve(); await gate.promise; return index()
    })
    const older = openSelectionLink(`${x}#abele-selection=sample-chat-x/sample-anchor-a`)
    await reading.promise
    expect(await comments.showInSidebar(yId)).toBe(true)
    const latest = chats.activeSession.value
    gate.resolve()
    await older
    expect(chats.activeSession.value).toBe(latest)
    expect(comments.isShown(yId)).toBe(true)
    expect(comments.isShown(xId)).toBe(false)
    expect(chats.openingSelection.value).toBe(false)
    expect(chats.pendingAnchorReturn.value).toBeNull()
  })

  it('a failed replacement save leaves every registered contextual tab intact', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.revealForAttention(app.vault.getFileByPath(y)!)
    const previous = chats.activeSession.value!
    previous.draft.value.text = 'A sample draft to preserve'
    previous.chatTitle.value = 'An unsaved sample title'
    const save = vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockRejectedValue(new Error('Sample write failure'))
    const opening = openChat(app.vault.getFileByPath(x)!)
    const outcome = await opening.then(() => ({ opened: true }), (error: unknown) => ({ error }))
    save.mockRestore()
    expect(outcome).toMatchObject({ error: expect.any(Error) })
    expect(chats.activeSession.value).toBe(previous)
    expect(chats.getSession(previous.id)).toBe(previous)
    expect(comments.isShown(yId)).toBe(true)
    expect(comments.isShown(xId)).toBe(false)
    expect(previous.isDestroyed).toBe(false)
    expect(previous.chatTitle.value).toBe('An unsaved sample title')
    await openChat(app.vault.getFileByPath(x)!)
    expect(chats.activeSession.value?.currentChatFile.value?.path).toBe(x)
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(y)!))?.title)
      .toBe('An unsaved sample title')
  })

  it('background attention hydration registers its tab without selecting or marking it as active', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const gate = deferred(), preparing = deferred()
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
    vi.spyOn(storage, 'prepareDiscussion').mockImplementationOnce(async (...args) => {
      preparing.resolve(); await gate.promise; return prepare(...args)
    })
    const older = comments.revealForAttention(app.vault.getFileByPath(x)!)
    await preparing.promise
    expect(await comments.revealForAttention(app.vault.getFileByPath(y)!)).toBe(true)
    const latest = chats.activeSession.value!
    gate.resolve()
    expect(await older).toBe(false)
    expect(chats.activeSession.value).toBe(latest)
    expect(comments.open.value).toBe(yId)
    expect(comments.isShown(xId)).toBe(true)
    expect(comments.isShown(yId)).toBe(true)
  })

  it('completion of a persisted expansion cannot select over a newer contextual action', async () => {
    useVault([{ path: x, content: content(x, xId) }, { path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const session = (await comments.load(xId))!
    const gate = deferred(), saving = deferred(), save = session.save.bind(session)
    vi.spyOn(session, 'save').mockImplementationOnce(async () => {
      saving.resolve(); await gate.promise; return save()
    })
    const older = comments.expand(xId)
    await saving.promise
    expect(await comments.showInSidebar(yId)).toBe(true)
    const latest = chats.activeSession.value!
    gate.resolve()
    expect(await older).toBe('moved')
    expect(chats.activeSession.value).toBe(latest)
    expect(comments.isShown(yId)).toBe(true)
    expect(comments.isExpanded(xId)).toBe(true)
    expect(session.kind).toBe('chat')
  })

  it('a current replacement saves a contextual tab hydrated after its initial release plan', async () => {
    const z = 'AI/Comments/sample-z.abchat', zId = 'sample-discussion-z'
    const app = useVault([
      { path: x, content: content(x, xId) }, { path: y, content: content(y, yId) },
      { path: z, content: content(z, zId) },
    ])
    app.saveLocalStorage('abele-agent-tabs', { tabs: [{ chatFilePath: y }, { chatFilePath: z }], activeIndex: 0 })
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    const loadGate = deferred(), loading = deferred(), saveGate = deferred(), saving = deferred()
    const storage = ChatStorage.getInstance(), prepare = storage.prepareDiscussion.bind(storage)
    let paused = false
    vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
      if (args[0].path === z && !paused) { paused = true; loading.resolve(); await loadGate.promise }
      return prepare(...args)
    })
    const restoring = chats.restoreTabs()
    await loading.promise
    const ownerY = chats.activeSession.value!, save = ownerY.save.bind(ownerY)
    vi.spyOn(ownerY, 'save').mockImplementationOnce(async () => {
      saving.resolve(); await saveGate.promise; return save()
    })
    const latest = openChat(app.vault.getFileByPath(x)!)
    await saving.promise
    loadGate.resolve()
    await restoring
    const ownerZ = chats.getSessionByFile(z)!
    const savedZ = vi.spyOn(ownerZ, 'save')
    saveGate.resolve()
    await latest
    expect(chats.activeSession.value?.currentChatFile.value?.path).toBe(x)
    expect(savedZ).toHaveBeenCalledOnce()
    expect(comments.isShown(xId)).toBe(true)
    expect(comments.isShown(yId)).toBe(false)
    expect(comments.isShown(zId)).toBe(false)
    expect(ownerY.isDestroyed).toBe(false)
    expect(ownerZ.isDestroyed).toBe(false)
  })

  it('deleting a discussion is terminal even if its expanded tab is reselected during saving', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.load(xId)
    await comments.expand(xId)
    const session = chats.activeSession.value!
    const gate = deferred(), saving = deferred(), save = session.save.bind(session)
    vi.spyOn(session, 'save').mockImplementationOnce(async () => {
      saving.resolve(); await gate.promise; return save()
    })
    const deleting = comments.remove(xId)
    await saving.promise
    chats.switchTab(session.id)
    gate.resolve()
    await deleting
    expect(session.isDestroyed).toBe(true)
    expect(chats.getSession(session.id)).toBeNull()
    expect(app.vault.getFileByPath(x)).toBeNull()
    await session.save()
    expect(app.vault.getFileByPath(x)).toBeNull()
  })

  it('a contextual dispatch honors an external scope guard without minting a live intent', async () => {
    const app = useVault([{ path: x, content: content(x, xId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    expect(await chats.openContextualChatFile(app.vault.getFileByPath(x)!, undefined, () => false)).toBe(false)
    expect(chats.getSessionByFile(x)).toBeNull()
    expect(comments.isShown(xId)).toBe(false)
  })

  it('a release requested by a synchronous observer waits for its queued admission result', async () => {
    useVault([{ path: y, content: content(y, yId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    await comments.showInSidebar(yId)
    const session = chats.activeSession.value!
    let released!: Promise<boolean>
    chats.mutatePresentation(() => { released = chats.releaseSession(session.id) })
    expect(await released).toBe(true)
    expect(chats.getSession(session.id)).toBeNull()
    expect(comments.isShown(yId)).toBe(false)
    expect(session.isDestroyed).toBe(false)
  })

  it('an expansion reserves its last tab slot before persisting the metadata change', async () => {
    useVault([{ path: x, content: content(x, xId) }])
    const chats = ChatService.getInstance(), comments = CommentService.getInstance()
    for (let index = 0; index < MAX_TABS - 1; index++) {
      chats.getSession(chats.createTab())!.draft.value.text = `A sample draft ${index}`
    }
    const session = (await comments.load(xId))!
    const gate = deferred(), saving = deferred(), save = session.save.bind(session)
    vi.spyOn(session, 'save').mockImplementationOnce(async () => {
      saving.resolve(); await gate.promise; return save()
    })
    const expanding = comments.expand(xId)
    await saving.promise
    const roomWhileSaving = chats.canCreateTab
    gate.resolve()
    expect(await expanding).toBe('moved')
    expect(roomWhileSaving).toBe(false)
    expect(chats.activeSession.value).toBe(session)
    expect(chats.tabOrder.value).toHaveLength(MAX_TABS)
  })

  it('the latest selection link to the same file survives cancellation of the first shared-load waiter', async () => {
    const app = useVault([
      { path: x, content: content(x, xId, true) },
      { path: y, content: content(y, yId) },
    ])
    const comments = CommentService.getInstance()
    const chats = ChatService.getInstance()
    await comments.showInSidebar(yId)
    const ownerY = chats.activeSession.value!
    const gate = deferred()
    const reached = deferred()
    const joined = deferred()
    const storage = ChatStorage.getInstance()
    const prepare = storage.prepareDiscussion.bind(storage)
    let paused = false
    vi.spyOn(storage, 'prepareDiscussion').mockImplementation(async (...args) => {
      if (args[0].path === x && !paused) {
        paused = true
        reached.resolve()
        await gate.promise
      }
      return prepare(...args)
    })
    const contextual = chats.openContextualChatFile.bind(chats)
    let requests = 0
    vi.spyOn(chats, 'openContextualChatFile').mockImplementation((...args) => {
      const task = contextual(...args)
      if (++requests === 2) joined.resolve()
      return task
    })
    const first = openSelectionLink(`${x}#abele-selection=sample-chat-x/sample-anchor-a`)
    await reached.promise
    const latest = openSelectionLink(`${x}#abele-selection=sample-chat-x/sample-anchor-b`)
    await joined.promise
    gate.resolve()
    await Promise.all([first, latest])
    const ownerX = chats.activeSession.value!
    expect(ownerX.currentChatFile.value?.path).toBe(x)
    expect(ownerX.commentId).toBe(xId)
    expect(
      chats.getAllSessions().filter((session) => session.currentChatFile.value?.path === x)
    ).toHaveLength(1)
    expect(chats.pendingAnchorReturn.value?.target.anchor.id).toBe('sample-anchor-b')
    expect(chats.pendingAnchorReturn.value?.sessionId).toBe(ownerX.id)
    expect(chats.openingSelection.value).toBe(false)
    expect(comments.isShown(yId)).toBe(false)
    expect(ownerY.isDestroyed).toBe(false)
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(x)!))?.commentId).toBe(
      xId
    )
  })
})
