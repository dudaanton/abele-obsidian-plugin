import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { serializeChat, parseChatMetadata } from '@/ai/ChatLog'
import { chatCopyPath } from '@/ai/chatCopy'
import { useVault } from '../helpers/testEnv'

const path = 'Chats/sample-ledger.abchat'
const error = { id: 'sample-error', at: 10, text: 'Sample failure' }
const meta = (extra: Partial<ChatMetadata> = {}): ChatMetadata => ({
  type: 'abele-chat',
  providerId: '',
  modelId: '',
  created: '',
  ...extra,
})
const content = (extra: Partial<ChatMetadata> = {}) =>
  serializeChat({ metadata: meta(extra), messages: [], internalMessages: [] })
const seed = (
  app: ReturnType<typeof useVault>,
  reasons = [{ kind: 'error', id: error.id, at: error.at }]
) => app.saveLocalStorage('abele-agents-index', [{ reference: { kind: 'local', path }, reasons }])
const stored = (app: ReturnType<typeof useVault>) =>
  JSON.stringify(app.loadLocalStorage('abele-agents-index'))
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

describe('durable attention evidence', () => {
  it.each([
    { nodes: [] },
    { nodes: [{ id: 'sample-node', label: 'Sample node', expectedNodeId: 'sample-identity' }] },
  ])('loads the ledger before registry publication (%j)', async ({ nodes }) => {
    const app = useVault([{ path, content: content() }])
    seed(app)
    app.saveLocalStorage('abele-node-registry', nodes)
    const agents = AgentsService.getInstance()
    agents.setNodes([])
    await agents.start()
    expect(stored(app)).toContain(error.id)
    expect(agents.badge.value.attention).toBe(1)
  })
  it('moves index-only evidence on rename without ever persisting its absence', async () => {
    const app = useVault([{ path, content: content() }])
    seed(app)
    const agents = AgentsService.getInstance()
    await agents.start()
    const saves = vi.spyOn(app, 'saveLocalStorage')
    const file = app.vault.getFileByPath(path)!
    await app.fileManager.renameFile(file, 'Chats/renamed-ledger.abchat')
    await agents.updateFile(file, path)
    expect(agents.badge.value.attention).toBe(1)
    expect(stored(app)).toContain('Chats/renamed-ledger.abchat')
    for (const [key, value] of saves.mock.calls)
      if (key === 'abele-agents-index') expect(JSON.stringify(value)).toContain(error.id)
  })
  it('applies external resolutions to an open session read-only and never resurrects them on a jump or save', async () => {
    const app = useVault([
      {
        path,
        content: content({
          attention: { errors: [error], approvals: { 'sample-request': 5 } },
          pendingToolCalls: [{ id: 'sample-request', name: 'edit', arguments: {} }],
        }),
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const stale = agents.rows.value[0]
    await app.vault.modify(
      session.currentChatFile.value!,
      content({ attention: { errors: [{ ...error, seen: true }], resolved: ['sample-request'] } })
    )
    const write = vi.spyOn(ChatStorage.getInstance(), 'saveChat')
    await agents.updateFile(session.currentChatFile.value!)
    expect(session.attention.value.errors?.[0].seen).toBe(true)
    expect(session.pendingToolCalls.value).toEqual([])
    expect(agents.badge.value.attention).toBe(0)
    await agents.open(stale, stale.reasons[0])
    expect(write).not.toHaveBeenCalled()
    await session.save()
    const saved = parseChatMetadata(await app.vault.read(session.currentChatFile.value!))!
    expect(saved.attention?.errors?.[0].seen).toBe(true)
    expect(saved.pendingToolCalls).toBeUndefined()
  })
  it('keeps a durable acknowledgement when a stale append overlaps an external edit', async () => {
    const app = useVault([{ path, content: content({ attention: { errors: [error] } }) }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const append = app.vault.append.bind(app.vault)
    vi.spyOn(app.vault, 'append').mockImplementationOnce(async (file, data) => {
      await app.vault.modify(file, content({ attention: { errors: [{ ...error, seen: true }] } }))
      return append(file, data)
    })
    await session.addUserNote('Another invented note')
    expect(parseChatMetadata(await app.vault.adapter.read(path))?.attention?.errors?.[0].seen).toBe(
      true
    )
    expect(session.attention.value.errors?.[0].seen).toBe(true)
    expect(agents.badge.value.attention).toBe(0)
  })
  it('rejects a stale full rewrite if an acknowledgement arrives while its backup is written', async () => {
    const app = useVault([{ path, content: content({ attention: { errors: [error] } }) }])
    const agents = AgentsService.getInstance()
    await agents.start()
    const file = app.vault.getFileByPath(path)!
    const write = app.vault.adapter.write.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'write').mockImplementationOnce(async (copy, bytes) => {
      await write(copy, bytes)
      await app.vault.modify(file, content({ attention: { errors: [{ ...error, seen: true }] } }))
    })
    const snapshot = {
      metadata: meta({ attention: { errors: [error] } }),
      messages: [],
      internalMessages: [],
    }
    await expect(
      ChatStorage.getInstance().saveChat(
        snapshot,
        { kind: 'rewrite', content: serializeChat(snapshot), records: 1 },
        file
      )
    ).rejects.toThrow('changed elsewhere')
    expect(parseChatMetadata(await app.vault.read(file))?.attention?.errors?.[0].seen).toBe(true)
    await agents.refresh()
    expect(agents.badge.value.attention).toBe(0)
  })
  it('retains index-only approvals and questions until a durable terminal identity contradicts them', async () => {
    const app = useVault([
      {
        path,
        content: content({ attention: { run: { id: 'older-run', at: 1, status: 'done' } } }),
      },
    ])
    seed(app, [
      { kind: 'approval', id: 'sample-request', at: 10 },
      { kind: 'question', id: 'sample-question', at: 11 },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.rows.value[0].reasons.map((r) => r.id)).toEqual(
      expect.arrayContaining(['sample-request', 'sample-question'])
    )
    expect(agents.incomplete.value).toBe(true)
    const file = app.vault.getFileByPath(path)!
    await app.vault.modify(
      file,
      content({ attention: { resolved: ['sample-request', 'sample-question'] } })
    )
    await agents.updateFile(file)
    expect(agents.rows.value).toEqual([])
    expect(stored(app)).not.toContain('sample-request')
  })
  it('keeps the sole durable failure evidence during a suspended Seen write', async () => {
    const app = useVault([{ path, content: content() }])
    seed(app)
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    const original = ChatStorage.getInstance().saveChat.bind(ChatStorage.getInstance())
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockImplementation(async (...args) => {
      await gate
      return original(...args)
    })
    const ack = agents.markSeen(agents.rows.value[0], error.id)
    try {
      await flushPromises()
      expect(stored(app)).toContain(error.id)
      expect(session.attention.value.errors?.find((e) => e.id === error.id)?.seen).not.toBe(true)
    } finally {
      release()
      await ack
    }
    expect(stored(app)).not.toContain(error.id)
    expect(parseChatMetadata(await app.vault.adapter.read(path))?.attention?.errors?.[0].seen).toBe(
      true
    )
  })
  it('shows an approved executing tool as work instead of another approval', async () => {
    const app = useVault([
      {
        path,
        content: content({
          attention: { approvals: { 'sample-request': 5 } },
          pendingToolCalls: [{ id: 'sample-request', name: 'sample_tool', arguments: {} }],
        }),
      },
    ])
    const agents = AgentsService.getInstance()
    await agents.start()
    const chats = ChatService.getInstance()
    await chats.openChatFile(app.vault.getFileByPath(path)!)
    const session = chats.activeSession.value!
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(session, 'getTools').mockReturnValue([
      {
        name: 'sample_tool',
        label: 'Sample tool',
        description: '',
        parameters: {},
        execute: async () => {
          await gate
          return { content: [{ type: 'text', text: 'Done' }] }
        },
      },
    ])
    vi.spyOn(
      session as unknown as { runAgentLoop(): Promise<void> },
      'runAgentLoop'
    ).mockResolvedValue(undefined)
    const running = session.approveToolCall()
    try {
      await flushPromises()
      expect(session.pendingToolCalls.value).toHaveLength(1)
      expect(
        parseChatMetadata(await app.vault.adapter.read(path))?.attention?.tools?.['sample-request']
      ).toBe('executing')
      expect(agents.badge.value.attention).toBe(0)
      expect(agents.badge.value.running).toBe(1)
    } finally {
      release()
      await running
      await session.save()
    }
  })
  it('does not admit a tool when its accepted identity cannot be saved', async () => {
    const app = useVault([
      {
        path,
        content: content({
          pendingToolCalls: [{ id: 'sample-request', name: 'sample_tool', arguments: {} }],
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
    vi.spyOn(ChatStorage.getInstance(), 'saveChat').mockRejectedValue(
      new Error('Sample storage unavailable')
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(session.approveToolCall()).rejects.toThrow('Операция не началась')
    expect(execute).not.toHaveBeenCalled()
    expect(stored(app)).toContain('sample-request')
  })
  it('discovers waiting actions through a safety copy without repairing either file', async () => {
    const app = useVault([{ path, content: '' }])
    const backup = chatCopyPath(app as any, path)
    const copy = `${path}\n${content({ attention: { errors: [error] } })}`
    await app.vault.adapter.write(backup, copy)
    seed(app)
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(agents.badge.value.attention).toBe(1)
    expect(await app.vault.adapter.read(path)).toBe('')
    expect(await app.vault.adapter.read(backup)).toBe(copy)
    expect(chatsCount()).toBe(0)
  })
  it('keeps unreadable evidence uncertain and refuses an unproven deletion', async () => {
    const app = useVault([{ path, content: '' }])
    seed(app)
    const agents = AgentsService.getInstance()
    await agents.start()
    agents.deleted(path)
    expect(stored(app)).toContain(error.id)
    expect(agents.incomplete.value).toBe(true)
    expect(agents.rows.value[0].uncertain).toBe(true)
  })
})
function chatsCount() {
  return ChatService.getInstance().getAllSessions().length
}
