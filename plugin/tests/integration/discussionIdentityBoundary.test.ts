import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AbelePlugin from '@/main'
import { AgentsService } from '@/agents/AgentsService'
import { ChatLogWriter, parseChat, parseChatMetadata, serializeChat, serializeMetadata } from '@/ai/ChatLog'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { backfillSummary } from '@/ai/ChatDigest'
import { attachNote, detachNote } from '@/ai/chatNoteLinks'
import { forkId } from '@/ai/commentIdentity'
import { openChat } from '@/ai/openChat'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/editor/CommentPlugin', () => ({ dispatchCommentsChanged: vi.fn(), setCommentInfoSource: vi.fn(), setCommentClickHandler: vi.fn() }))
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream() { yield { type: 'text_delta', delta: 'A sample summary.' } }
  },
}))
const original = 'AI/Comments/sample-source.abchat'
const copy = 'Archive/sample-source.abchat'
const sourceId = 'sample-source'
const metadata = (extra: Partial<ChatMetadata> = {}): ChatMetadata => ({
  type: 'abele-chat', providerId: '', modelId: '', created: '', kind: 'comment',
  anchor: { note: 'Notes/sample.md', quote: 'A sample passage' },
  commentId: sourceId, commentLocation: original, ...extra,
})
const content = (extra: Partial<ChatMetadata> = {}, history = false) => serializeChat({
  metadata: metadata(extra),
  messages: history ? [
    { id: 'sample-user', role: 'user', content: 'A sample question', timestamp: 1 },
    { id: 'sample-answer', parentId: 'sample-user', role: 'assistant', content: 'A sample answer', timestamp: 2 },
  ] : [], internalMessages: [],
})
type TestApp = ReturnType<typeof useVault>
const disk = async (app: TestApp, path: string) => parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))!
const cleanups: (() => void)[] = []
function wireRenameHandler(app: TestApp) {
  const plugin = Object.create(AbelePlugin.prototype) as AbelePlugin
  ;(plugin as unknown as { app: unknown }).app = app
  plugin.addCommand = vi.fn()
  plugin.addRibbonIcon = vi.fn(() => document.createElement('div'))
  plugin.register = (cleanup) => { cleanups.push(cleanup) }
  plugin.registerEvent = (ref) => { cleanups.push(() => app.vault.offref(ref as unknown as { id: string })) }
  ;(app as unknown as { workspace: unknown }).workspace = {
    iterateAllLeaves: () => {}, getLeavesOfType: () => [], on: () => ({ id: 'sample-event' }), onLayoutReady: () => {},
  }
  plugin.registerAiFeatures()
}
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getAuxiliaryModelConfig').mockReturnValue({
    id: 'sample-model', name: 'Sample', baseUrl: 'https://sample.invalid', contextWindow: 1000, maxTokens: 100, supportsReasoning: false,
  })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
  vi.restoreAllMocks()
})

describe('discussion identity at actual I/O boundaries', () => {
  it('file-link opening addresses the supplied same-basename copy, not the original marker', async () => {
    const app = useVault([{ path: original, content: content() }, { path: copy, content: content() }])
    await AgentsService.getInstance().start()
    const copyId = (await disk(app, copy)).commentId!
    expect(copyId).not.toBe(sourceId)
    await openChat(app.vault.getFileByPath(copy)!)
    const session = ChatService.getInstance().activeSession.value!
    expect(session.currentChatFile.value?.path).toBe(copy)
    expect(session.commentId).toBe(copyId)
    await session.save()
    expect((await disk(app, copy)).commentId).toBe(copyId)
    expect((await CommentService.getInstance().load(sourceId))?.currentChatFile.value?.path).toBe(original)
  })

  it.each(['original', 'undiscovered copy'] as const)('real trusted rename retains old-path provenance during preparation of an %s', async (kind) => {
    const app = useVault([
      { path: original, content: content() }, { path: copy, content: content() },
      { path: 'Chats/sample-other.abchat', content: serializeChat({ metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' }, messages: [], internalMessages: [] }) },
    ])
    wireRenameHandler(app)
    const old = kind === 'original' ? original : copy
    const file = app.vault.getFileByPath(old)!
    const next = 'Moved/sample-renamed.abchat'
    let release!: () => void
    let reached!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const readingOther = new Promise<void>((resolve) => { reached = resolve })
    const read = app.vault.read.bind(app.vault)
    let paused = false
    vi.spyOn(app.vault, 'read').mockImplementation(async (candidate) => {
      if (candidate.path !== old && !paused) { paused = true; reached(); await gate }
      return read(candidate)
    })
    const agents = AgentsService.getInstance()
    const update = agents.updateFile.bind(agents)
    let renamed!: Promise<void>
    vi.spyOn(agents, 'updateFile').mockImplementation((candidate, oldPath) => {
      const task = update(candidate, oldPath)
      if (oldPath === old) renamed = task
      return task
    })
    const preparing = ChatStorage.getInstance().prepareDiscussion(file)
    await readingOther
    await app.fileManager.renameFile(file, next)
    app.emit('vault', 'rename', file, old)
    release()
    await preparing
    await renamed
    const expected = kind === 'original' ? sourceId : await forkId(sourceId, old)
    expect(await disk(app, next)).toMatchObject({ commentId: expected, commentLocation: next })
    const owner = await CommentService.getInstance().load(expected)
    expect(owner?.currentChatFile.value?.path).toBe(next)
    await owner!.save()
    expect((await disk(app, next)).commentId).toBe(expected)
    expect((await CommentService.getInstance().load(sourceId))?.currentChatFile.value?.path).toBe(kind === 'original' ? next : original)
  })

  it('compaction cannot overwrite a same-identity sync revision arriving after the session revision check', async () => {
    const initial = content({ title: 'Before compaction' }, true)
    const app = useVault([{ path: original, content: initial + serializeMetadata(metadata({ title: 'Before compaction' })).repeat(40) }])
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(original)!)
    const session = ChatService.getInstance().activeSession.value!
    const file = app.vault.getFileByPath(original)!
    const source = parseChat(initial)
    const incoming = serializeChat({ ...source, metadata: source.metadata!, messages: [...source.messages, { id: 'sample-synced', parentId: 'sample-answer', role: 'assistant', content: 'An incoming answer', timestamp: 3 }] })
    const log = (session as unknown as { log: ChatLogWriter }).log
    const matches = log.matchesDiscussionRevision.bind(log)
    vi.spyOn(log, 'matchesDiscussionRevision').mockImplementationOnce((snapshot) => {
      const accepted = matches(snapshot)
      expect(accepted).toBe(true)
      // Fake vault modify commits immediately, before its returned promise settles.
      void app.vault.modify(file, incoming)
      app.emit('vault', 'modify', file)
      return accepted
    })
    const save = vi.spyOn(ChatStorage.getInstance(), 'saveChat')
    session.chatTitle.value = 'Local compaction'
    await session.save()
    expect(save.mock.calls[0][1].kind).toBe('rewrite')
    expect(await app.vault.read(file)).toBe(incoming)
    expect(parseChat(await app.vault.read(file)).messages.some((message) => message.id === 'sample-synced')).toBe(true)
  })

  it.each(['summary', 'attach', 'detach'] as const)('%s metadata writer cannot overwrite a synced self-located identity on an expanded discussion', async (operation) => {
    const path = 'Chats/sample-expanded.abchat'
    const prior = metadata({ kind: 'chat', commentId: 'sample-copy-b', commentLocation: path, touched: [{ path: 'Notes/sample.md', at: 'sample-time' }] })
    const app = useVault([{ path, content: content(prior, true) }, { path: 'Notes/sample.md', content: 'A note' }, { path: 'Notes/sample-attached.md', content: 'Another note' }])
    AbeleConfig.getInstance().ai.chatHistory = [{ path, title: 'Sample expanded', created: '' }]
    const file = app.vault.getFileByPath(path)!
    let arrived = false
    const append = app.vault.append.bind(app.vault)
    const process = app.vault.process.bind(app.vault)
    const arrive = async () => {
      if (arrived) return
      arrived = true
      await app.vault.modify(file, content({ ...prior, commentId: 'sample-copy-a', title: 'Incoming revision' }, true))
      app.emit('vault', 'modify', file)
    }
    vi.spyOn(app.vault, 'append').mockImplementation(async (target, data) => { await arrive(); return append(target, data) })
    vi.spyOn(app.vault, 'process').mockImplementation(async (target, change) => { await arrive(); return process(target, change) })
    const run = () => operation === 'summary' ? backfillSummary(path, new AbortController().signal) : operation === 'attach' ? attachNote(path, 'Notes/sample-attached.md') : detachNote(path, 'Notes/sample.md')
    try { await run() } catch { /* A checked conflict is allowed; replacing the incoming ID is not. */ }
    expect(arrived).toBe(true)
    expect(await disk(app, path)).toMatchObject({ commentId: 'sample-copy-a', commentLocation: path, title: 'Incoming revision' })
    await run()
    expect((await disk(app, path)).commentId).toBe('sample-copy-a')
    expect((await CommentService.getInstance().load('sample-copy-a'))?.currentChatFile.value?.path).toBe(path)
    expect(await CommentService.getInstance().load('sample-copy-b')).toBeNull()
  })

  it('1000-file discovery and marker lookup stay linear cold and bounded warm, including duplicate invalidation', async () => {
    const count = 1000
    const specs = Array.from({ length: count }, (_, index) => {
      const path = `AI/Comments/sample-${index}.abchat`
      return { path, content: content({ commentId: `sample-${index}`, commentLocation: path }) }
    })
    const app = useVault(specs)
    const comments = CommentService.getInstance()
    const session = await comments.load('sample-500')
    expect(session?.currentChatFile.value?.path).toBe(specs[500].path)
    expect(app.stats.read).toBeLessThan(count * 8)
    app.resetStats()
    expect(await comments.load('sample-500')).toBe(session)
    expect(app.stats.read).toBeLessThan(40)
    app.resetStats()
    session!.chatTitle.value = 'A short local edit'
    await session!.save()
    expect(app.stats.read).toBeLessThan(40)
    app.resetStats()
    await AgentsService.getInstance().start()
    expect(app.stats.read).toBeLessThan(count * 8)
    const conflicting = app.vault.getFileByPath(specs[999].path)!
    await app.vault.modify(conflicting, content({ commentId: 'sample-500', commentLocation: conflicting.path }))
    app.emit('vault', 'modify', conflicting)
    app.resetStats()
    expect(await comments.load('sample-500')).toBeNull()
    await comments.remove('sample-500')
    expect(app.stats.read).toBeLessThan(40)
    expect(app.vault.getFileByPath(specs[500].path)).not.toBeNull()
    expect(app.vault.getFileByPath(specs[999].path)).not.toBeNull()
  }, 30000)
})
