import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentsService } from '@/agents/AgentsService'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

const path = 'Chats/sample.abchat'
const content = (at: number) =>
  serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: '',
      modelId: '',
      created: '',
      attention: {
        errors: [{ id: `failure-${at}`, at, text: 'Synthetic failure' }],
        run: { id: `run-${at}`, at, status: 'interrupted' },
      },
    },
    messages: [],
    internalMessages: [],
  })
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(Date, 'now').mockReturnValue(1000)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

it.each([false, true])(
  'baselines historical failures, including an index without a cutoff: %s',
  async (indexed) => {
    const app = useVault([{ path, content: content(100) }])
    const file = app.vault.getFileByPath(path)!
    file.stat.mtime = 5000 // Copying or syncing old history is not a new failure.
    if (indexed)
      app.saveLocalStorage('abele-agents-index', [
        {
          reference: { kind: 'local', path },
          reasons: [
            { kind: 'error', id: 'failure-100', at: 100 },
            { kind: 'running', id: 'run-100', at: 100 },
          ],
        },
      ])
    const starting = AgentsService.getInstance().start()
    expect(AgentsService.getInstance().rows.value).toEqual([])
    await starting
    expect(AgentsService.getInstance().rows.value).toEqual([])
    expect(app.loadLocalStorage('abele-agents-started-at')).toBe(1000)
    expect(await app.vault.read(file)).toBe(content(100))
    AgentsService.destroyCurrent()
    vi.mocked(Date.now).mockReturnValue(2000)
    const agents = AgentsService.getInstance()
    await agents.start()
    expect(app.loadLocalStorage('abele-agents-started-at')).toBe(1000)
    await app.vault.modify(file, content(1500))
    await agents.updateFile(file)
    expect(agents.rows.value[0].reasons.map((r) => r.id)).toEqual(['failure-1500', 'run-1500'])
  }
)

it('keeps old unanswered questions, pending approvals and incomplete coverage', async () => {
  const app = useVault([
    {
      path,
      content: serializeChat({
        metadata: {
          type: 'abele-chat',
          providerId: '',
          modelId: '',
          created: '',
          pendingToolCalls: [{ id: 'approval', name: 'sample_tool', arguments: {} }],
          attention: {
            question: {
              id: 'question',
              at: 1,
              status: 'waiting',
              currentIndex: 0,
              questions: [{ question: 'Which sample?', options: [] }],
              answers: [],
            },
          },
        },
        messages: [],
        internalMessages: [],
      }),
    },
  ])
  const agents = AgentsService.getInstance()
  await agents.start()
  expect(agents.rows.value[0].reasons.map((r) => r.id)).toEqual(['approval', 'question'])
  await agents.markAllSeen()
  expect(agents.rows.value[0].reasons.map((r) => r.id)).toEqual(['approval', 'question'])
  vi.spyOn(app.vault, 'read').mockRejectedValue(new Error('Synthetic unavailable storage'))
  await agents.refresh()
  expect(agents.incomplete.value).toBe(true)
})

it('bulk marks dismissible evidence durably without answering questions or approving tools', async () => {
  const app = useVault([{ path, content: content(1500) }])
  app.saveLocalStorage('abele-agents-started-at', 0)
  const agents = AgentsService.getInstance()
  await agents.start()
  agents.setNodes([{ id: 'sample', label: 'Sample node', expectedNodeId: 'node' }])
  await agents.markAllSeen()
  expect(agents.rows.value.map((r) => r.reference.kind)).toEqual(['node'])
  const metadata = parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))!
  expect(metadata.attention?.errors?.[0].seen).toBe(true)
  expect(metadata.attention?.run?.status).toBe('done')
  expect(ChatService.getInstance().getAllSessions()).toHaveLength(0)
})

it('bulk acknowledges a live failure even before the conversation has a file', async () => {
  useVault([])
  const agents = AgentsService.getInstance()
  await agents.start()
  const chats = ChatService.getInstance()
  const session = chats.getSession(chats.createTab())!
  const firstSave = vi.spyOn(session, 'save').mockResolvedValueOnce(undefined)
  await session.addUserNote('Synthetic pending conversation')
  firstSave.mockRestore()
  session.recordAttentionError('Synthetic unsaved failure')
  expect(session.currentChatFile.value).toBeNull()
  expect(agents.rows.value).toHaveLength(1)
  await agents.markAllSeen()
  expect(agents.rows.value).toHaveLength(0)
  expect(session.attention.value.errors?.[0].seen).toBe(true)
})

it('opening acknowledges retained index-only failures without reconstructing file history', async () => {
  const app = useVault([{ path, content: content(100) }])
  app.saveLocalStorage('abele-agents-started-at', 1000)
  app.saveLocalStorage('abele-agents-index', [
    {
      reference: { kind: 'local', path },
      reasons: [{ kind: 'error', id: 'unsaved-error', at: 1500 }],
    },
  ])
  const agents = AgentsService.getInstance()
  await agents.start()
  const row = agents.rows.value[0]
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  expect(await agents.open(row, row.reasons[0])).toBe(true)
  expect(agents.rows.value).toHaveLength(0)
  const saved = parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))!
  expect(saved.attention?.resolved).toContain('unsaved-error')
  expect(saved.attention?.errors?.some((e) => e.id === 'unsaved-error')).toBe(false)
})

it('retains incomplete coverage and evidence when the baseline cannot be stored', async () => {
  const app = useVault([{ path, content: content(100) }])
  const save = app.saveLocalStorage.bind(app)
  vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
    if (key === 'abele-agents-started-at') throw new Error('Synthetic storage unavailable')
    save(key, value)
  })
  const agents = AgentsService.getInstance()
  await agents.start()
  expect(agents.incomplete.value).toBe(true)
  expect(agents.rows.value).toHaveLength(1)
})

it('does not publish an obsolete opening reveal after failure acknowledgement I/O', async () => {
  const app = useVault([{ path, content: content(1500) }])
  app.saveLocalStorage('abele-agents-started-at', 0)
  const agents = AgentsService.getInstance()
  await agents.start()
  const row = agents.rows.value[0]
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'revealSidebar').mockResolvedValue(undefined)
  let acknowledge!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(agents, 'markChatSeen').mockImplementation(async () => {
    started()
    await new Promise<void>((resolve) => {
      acknowledge = resolve
    })
  })
  const opening = agents.open(row, row.reasons[0])
  await entered
  chats.newTab()
  acknowledge()
  expect(await opening).toBe(false)
  expect(chats.pendingAttentionReveal.value).toBeNull()
})

it('opening a failed chat acknowledges its failures and retains its ordinary retry error', async () => {
  const app = useVault([{ path, content: content(1500) }])
  app.saveLocalStorage('abele-agents-started-at', 0)
  const agents = AgentsService.getInstance()
  await agents.start()
  const row = agents.rows.value[0]
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  expect(await agents.open(row, row.reasons[0])).toBe(true)
  const session = ChatService.getInstance().activeSession.value!
  expect(session.error.value).toBe('Synthetic failure')
  expect(session.attention.value.errors?.[0].seen).toBe(true)
  expect(agents.rows.value.flatMap((r) => r.reasons).some((r) => r.kind === 'error')).toBe(false)
})
