import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'
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
      chatId: 'sample-chat-x',
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
