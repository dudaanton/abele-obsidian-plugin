import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { serializeChat, parseChatMetadata } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const path = 'Chats/sample-review.abchat'
const metadata = (extra: Partial<ChatMetadata> = {}): ChatMetadata => ({
  type: 'abele-chat',
  providerId: '',
  modelId: '',
  created: '',
  ...extra,
})
const content = (extra: Partial<ChatMetadata> = {}) =>
  serializeChat({ metadata: metadata(extra), messages: [], internalMessages: [] })
const call = (id: string, slot: string) => ({ id, name: 'sample_tool', arguments: { slot } })
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

describe('reviewed attention exits and identity', () => {
  it('cannot transfer an approval to the next call if the approved call vanishes during save', async () => {
    const app = useVault([
      {
        path,
        content: content({
          pendingToolCalls: [call('sample-a', 'Original A'), call('sample-b', 'Original B')],
        }),
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Done' }] })
    vi.spyOn(session, 'getTools').mockReturnValue([
      { name: 'sample_tool', label: 'Sample tool', description: '', parameters: {}, execute },
    ])
    vi.spyOn(
      session as unknown as { runAgentLoop(): Promise<void> },
      'runAgentLoop'
    ).mockResolvedValue(undefined)
    const save = ChatStorage.getInstance().saveChat.bind(ChatStorage.getInstance())
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementationOnce(async (...args) => {
      await gate
      return save(...args)
    })
    const approvedArgs = { slot: 'Edited A' }
    const approving = session.approveToolCall(approvedArgs, false, 'sample-a')
    await flushPromises()
    await app.vault.modify(
      session.currentChatFile.value!,
      content({
        attention: { resolved: ['sample-a'] },
        pendingToolCalls: [call('sample-b', 'Original B')],
      })
    )
    await agents.updateFile(session.currentChatFile.value!)
    approvedArgs.slot = 'Mutated after approval'
    release()
    await approving
    expect(execute).not.toHaveBeenCalled()
    expect(session.pendingToolCalls.value.map((tc) => tc.id)).toEqual(['sample-b'])
    expect(session.allMessages.value.find((m) => m.toolCallId === 'sample-b')?.toolStatus).toBe(
      'pending'
    )
  })
  it('captures exact approved arguments even if the caller mutates them while save waits', async () => {
    const app = useVault([
      { path, content: content({ pendingToolCalls: [call('sample-a', 'Original A')] }) },
    ])
    await AgentsService.getInstance().start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Done' }] })
    vi.spyOn(session, 'getTools').mockReturnValue([
      { name: 'sample_tool', label: 'Sample tool', description: '', parameters: {}, execute },
    ])
    vi.spyOn(
      session as unknown as { runAgentLoop(): Promise<void> },
      'runAgentLoop'
    ).mockResolvedValue(undefined)
    const save = ChatStorage.getInstance().saveChat.bind(ChatStorage.getInstance())
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementationOnce(async (...args) => {
      await gate
      return save(...args)
    })
    const args = { slot: 'Approved A' }
    const approving = session.approveToolCall(args, false, 'sample-a')
    await flushPromises()
    args.slot = 'Different argument'
    release()
    await approving
    expect(execute.mock.calls[0][0]).toBe('sample-a')
    expect(execute.mock.calls[0][1]).toEqual({ slot: 'Approved A' })
  })
  it.each(['approval', 'question', 'running', 'interrupted'] as const)(
    'allows a durable exit for an index-only %s without deleting its conversation',
    async (kind) => {
      const app = useVault([{ path, content: content() }])
      app.saveLocalStorage('abele-agents-index', [
        { reference: { kind: 'local', path }, reasons: [{ kind, id: 'sample-stale', at: 10 }] },
      ])
      const agents = AgentsService.getInstance()
      await agents.start()
      await agents.markSeen(agents.rows.value[0], 'sample-stale')
      expect(app.vault.getFileByPath(path)).not.toBeNull()
      expect(agents.rows.value).toEqual([])
      expect(parseChatMetadata(await app.vault.adapter.read(path))?.attention?.resolved).toContain(
        'sample-stale'
      )
      AgentsService.destroyCurrent()
      await AgentsService.getInstance().start()
      expect(AgentsService.getInstance().rows.value).toEqual([])
    }
  )
  it('settles an accepted interrupted tool after a later successful run, not merely on opening', async () => {
    const app = useVault([
      { path, content: content({ attention: { tools: { 'sample-old-tool': 'executing' } } }) },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    expect(agents.rows.value[0].reasons.some((r) => r.id === 'sample-old-tool')).toBe(true)
    const run = session as unknown as {
      runAgentLoop(): Promise<void>
      runAgentLoopOnce(): Promise<void>
    }
    vi.spyOn(run, 'runAgentLoopOnce').mockResolvedValue(undefined)
    await run.runAgentLoop()
    await session.save()
    expect(
      agents.rows.value.flatMap((row) => row.reasons).some((r) => r.id === 'sample-old-tool')
    ).toBe(false)
    expect(parseChatMetadata(await app.vault.adapter.read(path))?.attention?.resolved).toContain(
      'sample-old-tool'
    )
  })
  it('does not dismiss stale evidence when the resolution write fails', async () => {
    const app = useVault([{ path, content: content() }])
    app.saveLocalStorage('abele-agents-index', [
      {
        reference: { kind: 'local', path },
        reasons: [{ kind: 'question', id: 'sample-unsaved-exit', at: 1 }],
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('Sample disk unavailable'))
    await expect(agents.markSeen(agents.rows.value[0], 'sample-unsaved-exit')).rejects.toThrow(
      'Sample disk unavailable'
    )
    expect(JSON.stringify(app.loadLocalStorage('abele-agents-index'))).toContain(
      'sample-unsaved-exit'
    )
    expect(
      parseChatMetadata(await app.vault.adapter.read(path))?.attention?.resolved ?? []
    ).not.toContain('sample-unsaved-exit')
  })
  it('does not settle an accepted interrupted tool after a later failed run', async () => {
    const app = useVault([
      { path, content: content({ attention: { tools: { 'sample-old-tool': 'executing' } } }) },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const run = session as unknown as {
      runAgentLoop(): Promise<void>
      runAgentLoopOnce(): Promise<void>
    }
    vi.spyOn(run, 'runAgentLoopOnce').mockImplementation(async () => {
      session.error.value = 'Sample run failed'
    })
    await run.runAgentLoop()
    await session.save()
    expect(
      agents.rows.value
        .flatMap((row) => row.reasons)
        .some((reason) => reason.id === 'sample-old-tool')
    ).toBe(true)
  })
  it('migrates a closed legacy discussion already expanded to a chat when its file is renamed', async () => {
    const old = 'AI/Comments/sample-legacy.abchat'
    const next = 'AI/Chats/sample-expanded.abchat'
    const app = useVault([
      { path: old, content: content({ kind: 'chat', anchor: { note: 'Notes/sample.md' } }) },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const file = app.vault.getFileByPath(old)!
    await app.fileManager.renameFile(file, next)
    await agents.updateFile(file, old)
    expect(parseChatMetadata(await app.vault.read(file))?.commentId).toBe('sample-legacy')
    CommentService.getInstance().destroy()
    AgentsService.destroyCurrent()
    await AgentsService.getInstance().start()
    const restored = await CommentService.getInstance().load('sample-legacy')
    expect(restored?.currentChatFile.value?.path).toBe(next)
    expect(restored?.kind).toBe('chat')
  })
  it.each([true, false])(
    'keeps a renamed original bound when its copy is scanned first (local locations: %s)',
    async (keepLocations) => {
      const old = 'AI/Comments/sample-marker.abchat'
      const renamed = 'AI/Comments/sample-renamed.abchat'
      const copied = 'AI/Comments/sample-copy.abchat'
      const app = useVault([
        { path: old, content: content({ kind: 'comment', anchor: { note: 'Notes/sample.md' } }) },
      ])
      ;(app as unknown as { workspace: unknown }).workspace = {
        iterateAllLeaves: () => {},
        getLeavesOfType: () => [],
      }
      const agents = AgentsService.getInstance()
      await agents.start()
      const file = app.vault.getFileByPath(old)!
      await app.fileManager.renameFile(file, renamed)
      await agents.updateFile(file, old)
      await app.vault.create(copied, await app.vault.read(file))
      const files = app.vault.getFiles.bind(app.vault)
      vi.spyOn(app.vault, 'getFiles').mockImplementation(() =>
        files().sort((a, b) => a.path.localeCompare(b.path))
      )
      CommentService.getInstance().destroy()
      ChatService.getInstance().destroy()
      AgentsService.destroyCurrent()
      if (!keepLocations) app.saveLocalStorage('abele-discussion-locations', null)
      await AgentsService.getInstance().start()
      const comments = CommentService.getInstance()
      expect(comments.commentPath('sample-marker')).toBe(renamed)
      const original = await comments.load('sample-marker')
      expect(original?.currentChatFile.value?.path).toBe(renamed)
      const copy = await comments.handOverToTab('sample-copy', app.vault.getFileByPath(copied)!)
      expect(copy?.currentChatFile.value?.path).toBe(copied)
      expect(copy?.commentId).not.toBe('sample-marker')
      expect(comments.sessionFor('sample-marker')).toBe(original)
    }
  )
})
