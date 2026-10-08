import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat, parseChatMetadata, parseChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const originalId = 'sample'
const originalPath = `AI/Comments/${originalId}.abchat`
const archivePath = `Archive/${originalId}.abchat`
const discussion = (flat = false) =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      kind: 'comment',
      commentId: originalId,
      anchor: { note: 'Notes/sample.md', quote: 'An invented sample passage' },
      providerId: '',
      modelId: '',
      created: '',
    },
    messages: flat
      ? [
          { id: 'sample-first', role: 'user', content: 'An invented first question', timestamp: 1 },
          { id: 'sample-reply', role: 'assistant', content: 'An invented answer', timestamp: 2 },
          { id: 'sample-next', role: 'user', content: 'An invented follow-up', timestamp: 3 },
        ]
      : [],
    internalMessages: [],
  })
function workspace(app: ReturnType<typeof useVault>) {
  ;(app as unknown as { workspace: unknown }).workspace = {
    iterateAllLeaves: () => {},
    getLeavesOfType: () => [],
  }
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

describe('one discussion identity resolver before any write', () => {
  it('resolves a copied old flat history before load migration can register its original identity', async () => {
    const copyPath = 'AI/Comments/sample-copy.abchat'
    const app = useVault([
      { path: originalPath, content: discussion(true) },
      { path: copyPath, content: discussion(true) },
    ])
    workspace(app)
    expect(app.loadLocalStorage('abele-discussion-locations')).toBeNull()
    const comments = CommentService.getInstance()
    const copy = await comments.handOverToTab('sample-copy', app.vault.getFileByPath(copyPath)!)
    expect(copy?.currentChatFile.value?.path).toBe(copyPath)
    expect(copy?.commentId).not.toBe(originalId)
    const migrated = parseChat(await app.vault.adapter.read(copyPath))
    expect(migrated.messages.some((message) => message.parentId)).toBe(true)
    expect(migrated.metadata?.commentId).toBe(copy?.commentId)
    const original = await comments.load(originalId)
    expect(original).not.toBe(copy)
    expect(original?.currentChatFile.value?.path).toBe(originalPath)
    expect(comments.commentPath(originalId)).toBe(originalPath)
    await AgentsService.getInstance().start()
    expect(comments.sessionFor(originalId)).toBe(original)
  })
  it('restores both direct identities before deriving aliases from same-basename locations', async () => {
    const app = useVault([
      { path: originalPath, content: discussion() },
      { path: archivePath, content: discussion() },
    ])
    workspace(app)
    await AgentsService.getInstance().start()
    const comments = CommentService.getInstance()
    const original = await comments.load(originalId)
    const copy = await comments.handOverToTab(originalId, app.vault.getFileByPath(archivePath)!)
    expect(copy).not.toBe(original)
    expect(copy?.commentId).not.toBe(originalId)
    await copy!.save()
    const copyId = copy!.commentId!
    expect(parseChatMetadata(await app.vault.adapter.read(archivePath))?.commentId).toBe(copyId)
    CommentService.getInstance().destroy()
    ChatService.getInstance().destroy()
    AgentsService.destroyCurrent()
    const restored = CommentService.getInstance()
    expect(restored.commentPath(originalId)).toBe(originalPath)
    expect(restored.commentPath(copyId)).toBe(archivePath)
    const reopened = await restored.load(originalId)
    expect(reopened?.currentChatFile.value?.path).toBe(originalPath)
    expect(reopened?.commentId).toBe(originalId)
    expect((await restored.load(copyId))?.currentChatFile.value?.path).toBe(archivePath)
  })
  it('does not select a comment owner by basename when a separate plain chat is renamed', async () => {
    const plain = serializeChat({
      metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
      messages: [],
      internalMessages: [],
    })
    const app = useVault([
      { path: originalPath, content: discussion() },
      { path: archivePath, content: plain },
    ])
    workspace(app)
    const agents = AgentsService.getInstance()
    await agents.start()
    const comments = CommentService.getInstance()
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    expect(await comments.revealForAttention(app.vault.getFileByPath(originalPath)!)).toBe(true)
    const original = chats.activeSession.value!
    const save = vi.spyOn(original, 'save')
    const file = app.vault.getFileByPath(archivePath)!
    const before = file.path
    await app.fileManager.renameFile(file, 'Archive/sample-topic.abchat')
    await agents.updateFile(file, before)
    expect(save).not.toHaveBeenCalled()
    expect(comments.isCommentFile(file)).toBe(false)
    await chats.openChatFile(file)
    const opened = chats.activeSession.value!
    expect(opened).not.toBe(original)
    expect(opened.kind).toBe('chat')
    const destroyed = vi.spyOn(opened, 'destroy')
    await chats.closeTab(opened.id)
    expect(destroyed).toHaveBeenCalledOnce()
    expect(chats.getSession(original.id)).toBe(original)
    expect(comments.sessionFor(originalId)).toBe(original)
  })
})
