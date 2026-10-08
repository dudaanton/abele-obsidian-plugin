import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { ShellModal } from '@/modal/ShellModal'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat, parseChatMetadata } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const evidence = { errors: [{ id: 'error-1', at: 10, text: 'Sample run failure' }] }
const content = (extra = {}) =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: '',
      modelId: '',
      created: '',
      title: 'Sample chat',
      attention: evidence,
      ...extra,
    },
    messages: [],
    internalMessages: [],
  })
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
})

describe('one list independent of open tabs', () => {
  it('finds unopened chats and discussions without creating a session', async () => {
    useVault([
      { path: 'Chats/sample.abchat', content: content() },
      {
        path: 'Comments/sample.abchat',
        content: content({
          kind: 'comment',
          anchor: { note: 'Notes/sample.md', quote: 'An invented passage' },
        }),
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.rows.value).toHaveLength(2)
    expect(
      agents.rows.value.find((r) => r.reference.path === 'Comments/sample.abchat')?.source
    ).toBe('Обсуждение · Notes/sample.md')
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(0)
    expect(agents.badge.value.attention).toBe(2)
    expect(agents.incomplete.value).toBe(true)
    expect(await CommentService.getInstance().load('sample')).toBeNull()
  })
  it('opens discussions through their owner without replacing another discussion tab', async () => {
    const app = useVault(
      ['first', 'second'].map((name) => ({
        path: `AI/Comments/${name}.abchat`,
        content: content({
          kind: 'comment',
          anchor: { note: 'Notes/sample.md', quote: `Sample ${name} passage` },
        }),
      }))
    )
    ;(app as unknown as { workspace: unknown }).workspace = {
      iterateAllLeaves: () => {},
      getLeavesOfType: () => [],
    }
    const agents = AgentsService.getInstance()
    await agents.start()
    const rows = [...agents.rows.value]
    vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
    await agents.open(rows[0], rows[0].reasons[0])
    const first = ChatService.getInstance().activeSession.value!
    await agents.open(rows[1], rows[1].reasons[0])
    expect(ChatService.getInstance().getSession(first.id)).toBe(first)
    expect(CommentService.getInstance().sessionFor('first')).toBe(first)
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(2)
    expect(agents.rows.value).toHaveLength(2)
  })
  it(
    'direct discussion file renames preserve tab closure and owner identity',
    async () => {
      const app = useVault([
        {
          path: 'AI/Comments/sample-discussion.abchat',
          content: content({ kind: 'comment', anchor: { note: 'Notes/sample.md' } }),
        },
      ])
      ;(app as unknown as { workspace: unknown }).workspace = {
        iterateAllLeaves: () => {},
        getLeavesOfType: () => [],
      }
      const agents = AgentsService.getInstance()
      await agents.start()
      const chats = ChatService.getInstance()
      vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
      const row = agents.rows.value[0]
      await agents.open(row, row.reasons[0])
      const session = chats.activeSession.value!
      const file = session.currentChatFile.value!
      const oldPath = file.path
      await app.fileManager.renameFile(file, 'AI/Comments/renamed-discussion.abchat')
      await agents.updateFile(file, oldPath)
      const renamed = agents.rows.value[0]
      await agents.open(renamed, renamed.reasons[0])
      await chats.closeTab(session.id)
      expect(chats.getSession(session.id)).toBeNull()
      expect(CommentService.getInstance().sessionFor('sample-discussion')).toBe(session)
      expect(CommentService.getInstance().sessionFor('renamed-discussion')).toBeNull()
    }
  )
  it(
    'preserves the original note-marker identity through a closed rename and restart',
    async () => {
      const app = useVault([
        {
          path: 'AI/Comments/sample-marker.abchat',
          content: content({ kind: 'comment', anchor: { note: 'Notes/sample.md' } }),
        },
      ])
      ;(app as unknown as { workspace: unknown }).workspace = {
        iterateAllLeaves: () => {},
        getLeavesOfType: () => [],
      }
      const agents = AgentsService.getInstance()
      await agents.start()
      const file = app.vault.getFileByPath('AI/Comments/sample-marker.abchat')!
      const oldPath = file.path
      await app.fileManager.renameFile(file, 'AI/Comments/renamed-marker.abchat')
      await agents.updateFile(file, oldPath)
      expect(parseChatMetadata(await app.vault.read(file))?.commentId).toBe('sample-marker')
      CommentService.getInstance().destroy()
      ChatService.getInstance().destroy()
      AgentsService.destroyCurrent()
      await AgentsService.getInstance().start()
      const comments = CommentService.getInstance()
      const restored = await comments.load('sample-marker')
      expect(restored?.currentChatFile.value?.path).toBe(file.path)
      expect(restored?.commentId).toBe('sample-marker')
      expect(comments.sessionFor('sample-marker')).toBe(restored)
      expect(comments.sessionFor('renamed-marker')).toBeNull()
    }
  )
  it('opens copied discussion files without stealing the original marker or writer', async () => {
    const app = useVault(
      ['sample-original', 'sample-copy'].map((name) => ({
        path: `AI/Comments/${name}.abchat`,
        content: content({
          kind: 'comment',
          commentId: 'sample-original',
          anchor: { note: 'Notes/sample.md' },
        }),
      }))
    )
    ;(app as unknown as { workspace: unknown }).workspace = {
      iterateAllLeaves: () => {},
      getLeavesOfType: () => [],
    }
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    const rows = [...agents.rows.value]
    const originalRow = rows.find((row) => row.key.endsWith('sample-original.abchat'))!
    const copyRow = rows.find((row) => row.key.endsWith('sample-copy.abchat'))!
    await agents.open(originalRow, originalRow.reasons[0])
    const original = chats.activeSession.value!
    await agents.open(copyRow, copyRow.reasons[0])
    const copy = chats.activeSession.value!
    expect(copy).not.toBe(original)
    expect(copy.currentChatFile.value?.path).toBe(copyRow.key)
    expect(CommentService.getInstance().sessionFor('sample-original')).toBe(original)
    await chats.closeTab(copy.id)
    expect(chats.getSession(original.id)).toBe(original)
  })
  it('does not let an older reconciliation read resurrect an acknowledged error', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    let release!: (text: string) => void
    vi.spyOn(app.vault, 'read').mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    const scanning = agents.refresh()
    const file = app.vault.getFileByPath('Chats/sample.abchat')!
    await app.vault.modify(
      file,
      content({ attention: { errors: [{ ...evidence.errors[0], seen: true }] } })
    )
    await agents.updateFile(file)
    release(content())
    await scanning
    expect(agents.rows.value).toHaveLength(0)
  })
  it('follows rename and deletion and keeps closed discussions', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const file = app.vault.getFileByPath('Chats/sample.abchat')!
    await app.fileManager.renameFile(file, 'Chats/renamed.abchat')
    await agents.refresh()
    expect(agents.rows.value[0].reference.path).toBe('Chats/renamed.abchat')
    await app.vault.delete(file)
    await agents.refresh()
    expect(agents.rows.value).toHaveLength(0)
  })
  it('persists only references, reasons and identities in the local index', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const stored = JSON.stringify(app.loadLocalStorage('abele-agents-index'))
    expect(stored).toContain('error-1')
    expect(stored).not.toContain('Sample run failure')
    expect(stored).not.toContain('Sample chat')
  })
  it('marks the specific error seen without opening or running the conversation', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    await agents.markSeen(agents.rows.value[0], 'error-1')
    expect(agents.rows.value).toHaveLength(0)
    expect(ChatService.getInstance().getAllSessions()).toHaveLength(0)
    expect(
      parseChatMetadata(await app.vault.adapter.read('Chats/sample.abchat'))?.attention?.errors?.[0]
        .seen
    ).toBe(true)
  })
  it('shows and opens live work even before a new chat has a file', async () => {
    useVault([])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    const id = chats.createTab()
    const session = chats.getSession(id)!
    session.isStreaming.value = true
    expect(agents.badge.value.running).toBe(1)
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    expect(await agents.open(agents.rows.value[0], agents.rows.value[0].reasons[0])).toBe(true)
    expect(chats.activeTabId.value).toBe(id)
  })
  it('does not replace an unsaved running conversation while returning to another chat', async () => {
    useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    const id = chats.createTab()
    const working = chats.getSession(id)!
    working.isStreaming.value = true
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    const target = agents.rows.value.find((row) => row.key === 'Chats/sample.abchat')!
    await agents.open(target, target.reasons[0])
    expect(working.currentChatFile.value).toBeNull()
    expect(chats.activeTabId.value).not.toBe(id)
    expect(chats.getSession(id)).toBe(working)
  })
  it('offers a choice at the full-tab limit without closing any tab automatically', async () => {
    useVault([{ path: 'Chats/sample.abchat', content: content() }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    for (let i = 0; i < 20; i++) {
      const id = chats.createTab()
      await chats.getSession(id)!.addUserNote(`Invented conversation ${i}`)
    }
    const original = [...chats.tabOrder.value]
    const revealing = vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    const titles = vi.spyOn(ShellModal.prototype, 'setTitle')
    const opened = agents.open(agents.rows.value[0], agents.rows.value[0].reasons[0])
    const title = titles.mock.calls.at(-1)![0]
    expect(title).toMatch(/закры/)
    expect(title.length).toBeLessThanOrEqual(32)
    expect(chats.tabOrder.value).toEqual(original)
    const choice = document.querySelector<HTMLButtonElement>('.modal button')!
    expect(choice).not.toBeNull()
    choice.click()
    expect(await opened).toBe(true)
    expect(chats.tabOrder.value).toHaveLength(20)
    expect(chats.tabOrder.value).not.toContain(original[0])
    expect(revealing).toHaveBeenCalledWith({ focus: false })
  })
  it('deduplicates a live discussion against its file and keeps its error after closure', async () => {
    useVault([])
    const agents = AgentsService.getInstance()
    await agents.start()
    const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'comment' })
    await session.addUserNote('Sample question')
    session.recordAttentionError('Sample failure')
    await session.save()
    await agents.refresh()
    expect(agents.rows.value).toHaveLength(1)
    session.destroy()
    expect(agents.rows.value).toHaveLength(1)
  })
  it('keeps a newer indexed run as interrupted when its file predates the transition', async () => {
    const app = useVault([
      { path: 'Chats/sample.abchat', content: content({ attention: undefined }) },
    ])
    app.saveLocalStorage('abele-agents-index', [
      {
        reference: { kind: 'local', path: 'Chats/sample.abchat' },
        reasons: [{ kind: 'running', id: 'new-run', at: 100 }],
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.rows.value[0]?.reasons).toContainEqual({
      kind: 'interrupted',
      id: 'new-run',
      at: 100,
    })
  })
  it('retains explicit indexed failures when their last chat write did not reach the file', async () => {
    const app = useVault([
      { path: 'Chats/sample.abchat', content: content({ attention: undefined }) },
    ])
    app.saveLocalStorage('abele-agents-index', [
      {
        reference: { kind: 'local', path: 'Chats/sample.abchat' },
        reasons: [{ kind: 'error', id: 'unsaved-error', at: 100 }],
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.badge.value.attention).toBe(1)
    expect(agents.rows.value[0].reasons[0].text).toContain('не сохранились')
    await agents.markSeen(agents.rows.value[0], 'unsaved-error')
    expect(agents.rows.value).toHaveLength(0)
  })
  it('never claims complete coverage when a registered node has no all-session summary', async () => {
    const app = useVault([])
    app.saveLocalStorage('abele-node-registry', [
      {
        id: 'sample-registration',
        label: 'Sample node',
        expectedNodeId: 'sample-node',
        url: 'http://127.0.0.1:1234',
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.badge.value.incomplete).toBe(true)
    expect(agents.rows.value[0]?.reasons[0].kind).toBe('delivery')
    agents.setNodes([])
    expect(agents.badge.value.incomplete).toBe(false)
  })
  it('reports incomplete data rather than a confident zero on a read failure', async () => {
    const app = useVault([{ path: 'Chats/sample.abchat', content: content() }])
    vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('Sample storage unavailable'))
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.badge.value.incomplete).toBe(true)
  })
})
