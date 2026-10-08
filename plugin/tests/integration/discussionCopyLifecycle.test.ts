import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AbelePlugin from '@/main'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const originalId = 'sample-original'
const originalPath = `AI/Comments/${originalId}.abchat`
const copyPath = 'AI/Comments/sample-copy.abchat'
const conversation = (id = originalId, location?: string) =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      kind: 'comment',
      commentId: id,
      commentLocation: location,
      anchor: { note: 'Notes/sample.md', quote: 'An invented sample passage' },
      providerId: '',
      modelId: '',
      created: '',
    },
    messages: [],
    internalMessages: [],
  })
const cleanups: (() => void)[] = []
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  await flushPromises()
  vi.restoreAllMocks()
})
function workspace(app: ReturnType<typeof useVault>) {
  ;(app as unknown as { workspace: unknown }).workspace = {
    iterateAllLeaves: () => {},
    getLeavesOfType: () => [],
    on: () => ({ id: 'sample-workspace-event' }),
    onLayoutReady: () => {},
  }
}

describe('discussion copy lifecycle independent of discovery', () => {
  it('gives a copy opened before scanning a separate identity and leaves the original marker bound to its file', async () => {
    const app = useVault([
      { path: originalPath, content: conversation() },
      { path: copyPath, content: conversation() },
    ])
    workspace(app)
    expect(app.loadLocalStorage('abele-discussion-locations')).toBeNull()
    const comments = CommentService.getInstance()
    // Tab restoration can run before the attention index begins its background scan.
    const copy = await comments.handOverToTab('sample-copy', app.vault.getFileByPath(copyPath)!)
    expect(copy?.currentChatFile.value?.path).toBe(copyPath)
    expect(copy?.commentId).not.toBe(originalId)
    const original = await comments.load(originalId)
    expect(original).not.toBe(copy)
    expect(original?.currentChatFile.value?.path).toBe(originalPath)
    expect(original?.commentId).toBe(originalId)
    await AgentsService.getInstance().start()
    expect(comments.sessionFor(originalId)).toBe(original)
    expect(await comments.load(originalId)).toBe(original)
  })

  it('deleting a discovered same-basename copy through the vault event does not destroy or close its original', async () => {
    const id = 'sample-discussion'
    const original = `AI/Comments/${id}.abchat`
    const copied = `Archive/${id}.abchat`
    const app = useVault([
      { path: original, content: conversation(id) },
      { path: copied, content: conversation(id) },
    ])
    workspace(app)
    const plugin = Object.create(AbelePlugin.prototype) as AbelePlugin
    ;(plugin as unknown as { app: unknown }).app = app
    plugin.addCommand = vi.fn()
    plugin.addRibbonIcon = vi.fn(() => document.createElement('div'))
    plugin.register = (cleanup: () => void) => {
      cleanups.push(cleanup)
    }
    plugin.registerEvent = (ref) => {
      cleanups.push(() => app.vault.offref(ref as unknown as { id: string }))
    }
    plugin.registerAiFeatures()
    const agents = AgentsService.getInstance()
    await agents.start()
    const comments = CommentService.getInstance()
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    expect(await comments.revealForAttention(app.vault.getFileByPath(original)!)).toBe(true)
    const owner = chats.activeSession.value!
    owner.isStreaming.value = true
    const destroyed = vi.spyOn(owner, 'destroy')
    const copyFile = app.vault.getFileByPath(copied)!
    expect(comments.isCommentFile(copyFile)).toBe(true)
    await app.vault.delete(copyFile)
    app.emit('vault', 'delete', copyFile)
    await flushPromises()
    expect(destroyed).not.toHaveBeenCalled()
    expect(owner.isDestroyed).toBe(false)
    expect(owner.isStreaming.value).toBe(true)
    expect(chats.getSession(owner.id)).toBe(owner)
    expect(chats.tabOrder.value).toContain(owner.id)
    expect(comments.commentPath(id)).toBe(original)
    expect(comments.sessionFor(id)).toBe(owner)
    expect(app.vault.getFileByPath(original)).not.toBeNull()
  })
})
