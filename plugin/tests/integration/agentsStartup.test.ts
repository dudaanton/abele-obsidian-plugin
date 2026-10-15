import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { AgentsService } from '@/agents/AgentsService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import * as ChatLog from '@/ai/ChatLog'
import { useAttentionVault as useVault } from '../helpers/attentionVault'
import { syntheticChats } from '../helpers/syntheticChats'

/**
 * Waits until every scheduled change has been read, rather than for a fixed time: the debounce is
 * 250 ms, but the read after it can take longer on a busy machine. Only a drain that never ends
 * reaches the bound.
 */
async function untilChangesDrained(agents: AgentsService): Promise<void> {
  // A scheduled file waits out its debounce first, so the flag is up until the drain has ended.
  await vi.waitFor(
    () => {
      if (agents['updating'].value) throw new Error('changes are still being read')
    },
    { timeout: 10_000, interval: 20 }
  )
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

it('never traverses the host graph of an open chat file', async () => {
  const app = useVault(syntheticChats(1))
  const chats = ChatService.getInstance()
  const session = new ChatSession(chats)
  chats.adoptSession(session)
  const visited = vi.fn(() => ({ files: app.vault.getFiles(), app }))
  const file = app.vault.getFiles()[0]
  Object.defineProperty(file, 'vault', { enumerable: true, get: visited })
  session.currentChatFile.value = file
  session.attention.value = { errors: [{ id: 'sample-error', at: 1, text: 'Sample' }] }
  await AgentsService.getInstance().start()
  expect(visited).not.toHaveBeenCalled()
})

it('publishes one startup scan batch rather than each open session truth update', async () => {
  const app = useVault(syntheticChats(12))
  const chats = ChatService.getInstance()
  for (const file of app.vault.getFiles()) {
    const session = new ChatSession(chats)
    chats.adoptSession(session)
    session.currentChatFile.value = file
  }
  const agents = AgentsService.getInstance()
  const published = vi.fn()
  const stop = watch(agents.rows, published, { flush: 'sync' })
  try {
    await agents.start()
    // Initial incomplete evidence, then the completed inventory (including all live holders).
    expect(published).toHaveBeenCalledTimes(2)
    expect(agents.badge.value.attention).toBe(2)
    expect(agents.incomplete.value).toBe(false)
  } finally {
    stop()
  }
})

it('keeps nested live attention and presentation changes synchronous after disk discovery', async () => {
  const app = useVault(syntheticChats(2))
  const chats = ChatService.getInstance()
  const session = new ChatSession(chats)
  chats.adoptSession(session)
  session.currentChatFile.value = app.vault.getFiles()[1]
  const agents = AgentsService.getInstance()
  await agents.start()
  session.attention.value = { errors: [{ id: 'live-error', at: 10, text: 'Before' }] }
  session.attention.value.errors![0].text = 'After'
  session.chatTitle.value = 'Live title'
  session.anchor.value = { note: 'Notes/first.md', quote: 'Before' }
  session.anchor.value.note = 'Samples/second.md'
  session.anchor.value.quote = 'After'
  session.pendingToolCalls.value.push({
    id: 'live-call',
    name: 'first_tool',
    arguments: {},
    type: 'toolCall',
  })
  session.pendingToolCalls.value[0].name = 'second_tool'
  expect(
    agents.rows.value.find((row) => row.key === session.currentChatFile.value!.path)
  ).toMatchObject({
    title: 'Live title',
    folder: 'Samples',
    quote: 'After',
    reasons: expect.arrayContaining([
      expect.objectContaining({ id: 'live-error', text: 'After' }),
      expect.objectContaining({ id: 'live-call', text: 'second_tool' }),
    ]),
  })
  session.currentChatFile.value = null
  expect(agents.rows.value.some((row) => row.reference.sessionId === session.id)).toBe(true)
})

it('publishes a saved disk decision only after all holder refs have been reconciled', async () => {
  const app = useVault(syntheticChats(1))
  const chats = ChatService.getInstance()
  const session = new ChatSession(chats)
  chats.adoptSession(session)
  const file = app.vault.getFiles()[0]
  session.currentChatFile.value = file
  session.pendingToolCalls.value = [
    {
      id: 'sample-call',
      name: 'sample_tool',
      arguments: {},
      type: 'toolCall',
    },
  ]
  const agents = AgentsService.getInstance()
  await agents.start()
  const published = vi.fn()
  const stop = watch(agents.rows, published, { flush: 'sync' })
  try {
    await app.vault.modify(
      file,
      serializeChat({
        metadata: {
          type: 'abele-chat',
          providerId: '',
          modelId: '',
          created: '',
          attention: { resolved: ['sample-call'] },
        },
        messages: [],
        internalMessages: [],
      })
    )
    await agents.updateFile(file)
    expect(session.pendingToolCalls.value).toEqual([])
    expect(published).toHaveBeenCalledTimes(1)
    expect(
      agents.rows.value.flatMap((row) => row.reasons).some((r) => r.id === 'sample-call')
    ).toBe(false)
    session.recordAttentionError('A later live error')
    expect(published).toHaveBeenCalledTimes(2)
  } finally {
    stop()
  }
})

it('does not prepare ordinary transcripts during attention discovery', async () => {
  useVault(syntheticChats(3))
  const prepare = vi.spyOn(ChatStorage.getInstance(), 'prepareDiscussion')
  await AgentsService.getInstance().start()
  expect(prepare).not.toHaveBeenCalled()
})

it('checks normalized discussion ownership without constructing its transcript', async () => {
  const path = 'SyntheticChats/discussion.abchat'
  useVault([
    {
      path,
      content: serializeChat({
        metadata: {
          type: 'abele-chat',
          providerId: '',
          modelId: '',
          created: '',
          kind: 'comment',
          commentId: 'synthetic-discussion',
          commentLocation: path,
          anchor: { note: 'Notes/sample.md' },
          attention: { errors: [{ id: 'synthetic-error', at: 1, text: 'Synthetic error' }] },
        },
        messages: [],
        internalMessages: [],
      }),
    },
  ])
  const fullParse = vi.spyOn(ChatLog, 'parseChat')
  await AgentsService.getInstance().start()
  expect(AgentsService.getInstance().badge.value.attention).toBe(1)
  expect(AgentsService.getInstance().incomplete.value).toBe(false)
  expect(fullParse).not.toHaveBeenCalled()
})

it('preserves the complete legacy transcript when discovery must normalize a discussion', async () => {
  const path = 'AI/Comments/sample-legacy.abchat'
  const messages = [
    { id: 'sample-message', role: 'assistant', content: 'Synthetic legacy message', timestamp: 1 },
  ]
  const internalMessages = [{ role: 'assistant', content: 'Synthetic internal message' }]
  const app = useVault([
    {
      path,
      content: JSON.stringify({
        metadata: {
          type: 'abele-chat',
          providerId: '',
          modelId: '',
          created: '',
          kind: 'comment',
          anchor: { note: 'Notes/sample.md' },
        },
        messages,
        internalMessages,
      }),
    },
  ])
  await AgentsService.getInstance().start()
  const saved = ChatLog.parseChat(await app.vault.read(app.vault.getFileByPath(path)!))
  expect(saved.metadata?.commentId).toBe('sample-legacy')
  expect(saved.messages).toEqual(messages)
  expect(saved.internalMessages).toEqual(internalMessages)
  expect(saved.version).toBe(2)
})

it('reuses unchanged attention snapshots after restart, including quiet chats', async () => {
  const app = useVault(syntheticChats(3))
  await AgentsService.getInstance().start()
  const before = AgentsService.getInstance().badge.value
  AgentsService.destroyCurrent()
  const read = vi.spyOn(app.vault, 'read')
  await AgentsService.getInstance().start()
  expect(AgentsService.getInstance().badge.value).toEqual(before)
  expect(read).not.toHaveBeenCalled()
})

it('rereads only the changed file on restart and retains quiet terminal evidence', async () => {
  const app = useVault(syntheticChats(3))
  await AgentsService.getInstance().start()
  AgentsService.destroyCurrent()
  const file = app.vault.getFiles()[1]
  await app.vault.modify(
    file,
    serializeChat({
      metadata: {
        type: 'abele-chat',
        providerId: '',
        modelId: '',
        created: '',
        attention: { errors: [{ id: 'new-failure', at: 5, text: 'Synthetic new failure' }] },
      },
      messages: [],
      internalMessages: [],
    })
  )
  // The text-only fake modify does not advance TFile.stat; Obsidian does before its event.
  file.stat.mtime++
  const read = vi.spyOn(app.vault, 'read')
  await AgentsService.getInstance().start()
  expect(read.mock.calls.map(([f]) => f.path)).toEqual([file.path])
  expect(AgentsService.getInstance().badge.value.attention).toBe(2)
})

it('retains accepted tool truth across a warm restart and a stale synced request', async () => {
  const path = 'SyntheticChats/accepted.abchat'
  const content = (accepted: boolean) =>
    serializeChat({
      metadata: {
        type: 'abele-chat',
        providerId: '',
        modelId: '',
        created: '',
        pendingToolCalls: [{ id: 'sample-call', name: 'sample_tool', arguments: {} }],
        attention: accepted ? { tools: { 'sample-call': 'interrupted' } } : {},
      },
      messages: [],
      internalMessages: [],
    })
  const app = useVault([{ path, content: content(true) }])
  await AgentsService.getInstance().start()
  AgentsService.destroyCurrent()
  const read = vi.spyOn(app.vault, 'read')
  const agents = AgentsService.getInstance()
  await agents.start()
  expect(read).not.toHaveBeenCalled()
  const file = app.vault.getFileByPath(path)!
  await app.vault.modify(file, content(false))
  await agents.updateFile(file)
  expect(agents.rows.value[0].reasons[0].kind).toBe('interrupted')
})

it('does not turn unconfirmed index-only evidence into complete coverage on restart', async () => {
  const app = useVault(syntheticChats(2))
  await AgentsService.getInstance().start()
  AgentsService.destroyCurrent()
  const index = app.loadLocalStorage('abele-agents-index')
  index[0].reasons.push({ kind: 'question', id: 'unsaved-question', at: 5 })
  app.saveLocalStorage('abele-agents-index', index)
  const read = vi.spyOn(app.vault, 'read')
  await AgentsService.getInstance().start()
  expect(read).toHaveBeenCalledTimes(1)
  expect(AgentsService.getInstance().incomplete.value).toBe(true)
  expect(
    AgentsService.getInstance().rows.value[0].reasons.some((r) => r.id === 'unsaved-question')
  ).toBe(true)
})

it('discovers a recreated path after cancelling its deleted pending revision', async () => {
  const fixture = syntheticChats(1)
  const app = useVault(fixture)
  const agents = AgentsService.getInstance()
  await agents.start()
  const file = app.vault.getFiles()[0]
  agents.scheduleFile(file)
  await app.vault.delete(file)
  agents.deleted(file.path)
  const recreated = await app.vault.create(fixture[0].path, fixture[0].content)
  agents.scheduleFile(recreated)
  await untilChangesDrained(agents)
  expect(agents.badge.value.attention).toBe(1)
  expect(agents.rows.value[0].reference.path).toBe(recreated.path)
})

it('cancels a pending change when the service unloads', async () => {
  const app = useVault(syntheticChats(2))
  const agents = AgentsService.getInstance()
  await agents.start()
  const read = vi.spyOn(app.vault, 'read')
  agents.scheduleFile(app.vault.getFiles()[0])
  AgentsService.destroyCurrent()
  await new Promise((resolve) => setTimeout(resolve, 350))
  expect(read).not.toHaveBeenCalled()
})

it('ignores discovery events before layout readiness and coalesces streamed writes', async () => {
  const app = useVault(syntheticChats(3))
  const agents = AgentsService.getInstance()
  const read = vi.spyOn(app.vault, 'read')
  const file = app.vault.getFiles()[0]
  for (let i = 0; i < 20; i++) agents.scheduleFile(file)
  expect(read).not.toHaveBeenCalled()
  await agents.start()
  read.mockClear()
  for (let i = 0; i < 20; i++) agents.scheduleFile(file)
  await untilChangesDrained(agents)
  expect(read).toHaveBeenCalledTimes(1)
})

it('serializes different changed files and does not race the initial inventory', async () => {
  const app = useVault(syntheticChats(3))
  const agents = AgentsService.getInstance()
  const original = app.vault.read.bind(app.vault)
  let active = 0,
    peak = 0
  vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    try {
      return await original(file)
    } finally {
      active--
    }
  })
  const starting = agents.start()
  for (const file of app.vault.getFiles()) agents.scheduleFile(file)
  await starting
  await untilChangesDrained(agents)
  expect(peak).toBe(1)
})

it.runIf(process.env.MEASURE_AGENTS === '1')(
  'measures synthetic startup and event bursts',
  async () => {
    const fixture = syntheticChats()
    const app = useVault(fixture)
    const read = vi.spyOn(app.vault, 'read')
    let previous = performance.now()
    const stalls: number[] = []
    const heartbeat = setInterval(() => {
      const now = performance.now()
      stalls.push(now - previous)
      previous = now
    }, 5)
    try {
      for (const phase of ['cold', 'warm']) {
        read.mockClear()
        stalls.length = 0
        previous = performance.now()
        const start = performance.now()
        await AgentsService.getInstance().start()
        await new Promise((resolve) => setTimeout(resolve, 10))
        console.log(
          JSON.stringify({
            phase,
            files: fixture.length,
            bytes: fixture.reduce((n, f) => n + f.content.length, 0),
            ms: Math.round(performance.now() - start),
            reads: read.mock.calls.length,
            maxHeartbeatMs: Math.round(Math.max(0, ...stalls)),
            longTasks: stalls.filter((n) => n > 50).length,
          })
        )
        AgentsService.destroyCurrent()
      }
    } finally {
      clearInterval(heartbeat)
    }
  },
  120000
)
