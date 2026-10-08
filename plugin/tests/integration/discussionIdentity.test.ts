import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentsService } from '@/agents/AgentsService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMetadata } from '@/ai/types'
import { parseChat, parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const original = 'AI/Comments/sample-owner.abchat'
const copy = 'Archive/sample-owner.abchat'
const id = 'sample-owner'
const metadata = (extra: Partial<ChatMetadata> = {}): ChatMetadata => ({
  type: 'abele-chat',
  providerId: '',
  modelId: '',
  created: '',
  kind: 'comment',
  anchor: { note: 'Notes/sample.md', quote: 'Sample passage' },
  commentId: id,
  commentLocation: original,
  ...extra,
})
const content = (extra: Partial<ChatMetadata> = {}, flat = false) =>
  serializeChat({
    metadata: metadata(extra),
    messages: flat
      ? [
          { id: 'sample-u', role: 'user', content: 'Question', timestamp: 1 },
          { id: 'sample-a', role: 'assistant', content: 'Answer', timestamp: 2 },
        ]
      : [],
    internalMessages: [],
  })
const fixture = (flat = false) =>
  useVault([
    { path: 'Notes/sample.md', content: `Sample passage%%c:${id}%%` },
    { path: original, content: content({}, flat) },
    { path: copy, content: content({}, flat) },
  ])
type TestApp = ReturnType<typeof useVault>
const disk = async (app: TestApp, path: string) =>
  parseChatMetadata(await app.vault.read(app.vault.getFileByPath(path)!))!
const restart = () => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AgentsService.destroyCurrent()
  ChatStorage.destroy()
}
const marker = async () => {
  const session = await CommentService.getInstance().load(id)
  expect(session?.currentChatFile.value?.path).toBe(original)
  expect(session?.commentId).toBe(id)
  return session!
}
const normalized = async (app: TestApp, path = copy) => {
  const data = await disk(app, path)
  expect(data.commentId).toMatch(/^fork-v1-[0-9a-f]{64}$/)
  expect(data.commentLocation).toBe(path)
  return data.commentId!
}
beforeEach(() => {
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})
afterEach(() => {
  restart()
  vi.restoreAllMocks()
})

describe('file-owned discussion identity', () => {
  it('1 prepares a copy handed to a tab before discovery, without redirecting the original marker', async () => {
    const app = fixture()
    const session = await CommentService.getInstance().handOverToTab(
      id,
      app.vault.getFileByPath(copy)!
    )
    expect(session?.commentId).toBe(await normalized(app))
    await session!.save()
    await marker()
  })
  it('2 prepares outside-folder ChatService opens and direct session loads', async () => {
    const app = fixture()
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
    expect(ChatService.getInstance().activeSession.value?.commentId).toBe(await normalized(app))
    restart()
    const direct = new ChatSession(ChatService.getInstance())
    try {
      await direct.load(app.vault.getFileByPath(copy)!)
      expect(direct.commentId).toBe(await normalized(app))
      await direct.save()
      await marker()
    } finally {
      direct.destroy()
    }
  })
  it('3 every migration write and notification carries the committed copy identity', async () => {
    const app = fixture(true)
    const writes: ChatMetadata[] = []
    for (const method of ['process', 'modify', 'append'] as const) {
      const fn = app.vault[method].bind(app.vault)
      vi.spyOn(app.vault, method).mockImplementation(async (...args: any[]) => {
        const result = await (fn as any)(...args)
        if (args[0].path === copy) writes.push(await disk(app, copy))
        return result
      })
    }
    for (const entry of ['handover', 'service', 'direct']) {
      const notifications = vi.spyOn(AgentsService.getInstance(), 'saved')
      const source = content({ toolModes: { mcp_sample_tool: 'auto' } }, true)
      const initial = entry === 'direct' ? JSON.stringify(parseChat(source)) : source
      await app.vault.modify(app.vault.getFileByPath(copy)!, initial)
      writes.length = 0
      const direct = entry === 'direct' ? new ChatSession(ChatService.getInstance()) : null
      try {
        if (direct) await direct.load(app.vault.getFileByPath(copy)!)
        else if (entry === 'handover')
          await CommentService.getInstance().handOverToTab(id, app.vault.getFileByPath(copy)!)
        else await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
        const fork = await normalized(app)
        const live =
          direct ??
          (entry === 'service'
            ? ChatService.getInstance().activeSession.value
            : [...CommentService.getInstance().sessions.values()].find(
                (session) => session.currentChatFile.value?.path === copy
              ))
        expect(live?.commentId).toBe(fork)
        expect(writes.length).toBeGreaterThan(0)
        expect(
          writes.every((data) => data.commentId === fork && data.commentLocation === copy)
        ).toBe(true)
        const saved = notifications.mock.calls.filter(([path]) => path === copy)
        expect(saved.length).toBeGreaterThan(0)
        expect(
          saved.every(([, data]) => data.commentId === fork && data.commentLocation === copy)
        ).toBe(true)
        expect((await disk(app, copy)).overrides?.toolModes).not.toHaveProperty('mcp_sample_tool')
        expect(
          parseChat(await app.vault.read(app.vault.getFileByPath(copy)!)).messages
        ).toHaveLength(2)
        await marker()
      } finally {
        direct?.destroy()
        restart()
        notifications.mockRestore()
      }
    }
  })
  it('4 scan order and stale local locations cannot outrank a renamed self-located original', async () => {
    for (const reverse of [false, true])
      for (const stale of [false, true]) {
        const renamed = 'Moved/sample-original.abchat'
        const specs = [
          { path: copy, content: content() },
          { path: renamed, content: content({ commentLocation: renamed }) },
        ]
        const app = useVault(reverse ? specs.reverse() : specs)
        if (stale) app.saveLocalStorage('abele-discussion-locations', { [id]: copy })
        await AgentsService.getInstance().start()
        await normalized(app)
        expect((await CommentService.getInstance().load(id))?.currentChatFile.value?.path).toBe(
          renamed
        )
        restart()
      }
  })
  it('5 discovery commits normalization without sessions; rescans and restart change no bytes', async () => {
    const app = fixture()
    await AgentsService.getInstance().start()
    await normalized(app)
    expect(ChatService.getInstance().getAllSessions()).toEqual([])
    const bytes = await app.vault.read(app.vault.getFileByPath(copy)!)
    await AgentsService.getInstance().refresh()
    restart()
    await AgentsService.getInstance().start()
    expect(await app.vault.read(app.vault.getFileByPath(copy)!)).toBe(bytes)
  })
  it('6 a same-basename copy deletion through the vault handler preserves the original tab and running owner', async () => {
    const app = fixture()
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(original)!)
    const owner = ChatService.getInstance().activeSession.value!
    owner.isStreaming.value = true
    await AgentsService.getInstance().start()
    app.vault.on('delete', (file: any) => CommentService.getInstance().handleFileDeleted(file.path))
    await app.fileManager.trashFile(app.vault.getFileByPath(copy)!)
    expect(owner.isDestroyed).toBe(false)
    expect(owner.isStreaming.value).toBe(true)
    expect(ChatService.getInstance().getSession(owner.id)).toBe(owner)
    expect(await marker()).toBe(owner)
  })
  it('7 deleting the original leaves its marker broken and remove cannot delete the remaining copy', async () => {
    const app = fixture()
    await AgentsService.getInstance().start()
    await app.fileManager.trashFile(app.vault.getFileByPath(original)!)
    CommentService.getInstance().handleFileDeleted(original)
    expect(await CommentService.getInstance().load(id)).toBeNull()
    await CommentService.getInstance().remove(id)
    expect(app.vault.getFileByPath(copy)).not.toBeNull()
    expect(await app.vault.read(app.vault.getFileByPath('Notes/sample.md')!)).toContain(
      `%%c:${id}%%`
    )
  })
  it('8 restart discards conflicting persisted aliases and locations', async () => {
    const app = fixture()
    await AgentsService.getInstance().start()
    const fork = await normalized(app)
    restart()
    app.saveLocalStorage('abele-discussion-locations', { [id]: copy, [fork]: original })
    app.saveLocalStorage('abele-discussion-aliases', { [id]: fork })
    await marker()
  })
  it('9 renaming an ordinary same-basename chat neither selects nor changes a discussion owner', async () => {
    const app = fixture()
    await app.vault.modify(
      app.vault.getFileByPath(copy)!,
      content({ kind: 'chat', anchor: undefined, commentId: undefined, commentLocation: undefined })
    )
    const owner = await marker()
    const file = app.vault.getFileByPath(copy)!
    await app.fileManager.renameFile(file, 'Archive/sample-normal.abchat')
    await AgentsService.getInstance().updateFile(file, copy)
    await ChatService.getInstance().openChatFile(file)
    expect(ChatService.getInstance().activeSession.value?.kind).toBe('chat')
    expect(ChatService.getInstance().activeSession.value?.commentId).toBeNull()
    expect(await marker()).toBe(owner)
  })
  it('10 trusted rename normalizes an undiscovered copy at its old logical path', async () => {
    const app = fixture()
    const file = app.vault.getFileByPath(copy)!
    const next = 'Archive/sample-renamed.abchat'
    await app.fileManager.renameFile(file, next)
    await AgentsService.getInstance().updateFile(file, copy)
    const renamedId = await normalized(app, next)
    const owner = await CommentService.getInstance().load(renamedId)
    expect(owner?.commentId).toBe(renamedId)
    await owner!.save()
    expect((await disk(app, next)).commentId).toBe(renamedId)
    await marker()
    restart()
    const second = fixture()
    await AgentsService.getInstance().start()
    expect(await normalized(second)).toBe(renamedId)
  })
  it('11 trusted rename retains a legacy anchored kind chat historical identity', async () => {
    const app = useVault([
      {
        path: original,
        content: content({ kind: 'chat', commentId: undefined, commentLocation: undefined }),
      },
    ])
    const file = app.vault.getFileByPath(original)!
    const next = 'Moved/sample-expanded.abchat'
    await app.fileManager.renameFile(file, next)
    await AgentsService.getInstance().updateFile(file, original)
    expect(await disk(app, next)).toMatchObject({
      kind: 'chat',
      commentId: id,
      commentLocation: next,
    })
    expect((await CommentService.getInstance().load(id))?.currentChatFile.value?.path).toBe(next)
  })
  it('12 independent devices agree on the fork in scan-first and open-first orders', async () => {
    const ids: string[] = []
    for (const scan of [true, false, false, true]) {
      const app = fixture()
      if (scan) await AgentsService.getInstance().start()
      else await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
      ids.push(await normalized(app))
      await marker()
      restart()
    }
    expect(new Set(ids).size).toBe(1)
  })
  it('13 incoming self-located identity supersedes local assignments, live holder, restart and next save', async () => {
    const app = fixture()
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
    const session = ChatService.getInstance().activeSession.value!
    await app.vault.modify(
      app.vault.getFileByPath(copy)!,
      content({ commentId: 'sample-copy-a', commentLocation: copy, title: 'Incoming title' })
    )
    await AgentsService.getInstance().updateFile(app.vault.getFileByPath(copy)!)
    expect(session.commentId).toBe('sample-copy-a')
    await session.save()
    expect(await disk(app, copy)).toMatchObject({
      commentId: 'sample-copy-a',
      title: 'Incoming title',
    })
    restart()
    expect(
      (await CommentService.getInstance().load('sample-copy-a'))?.currentChatFile.value?.path
    ).toBe(copy)
  })
  it('13 fences a busy obsolete holder and concurrent conversation edits instead of overwriting sync', async () => {
    const app = fixture()
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
    const session = ChatService.getInstance().activeSession.value!
    session.isStreaming.value = true
    const incoming = content({
      commentId: 'sample-copy-a',
      commentLocation: copy,
      title: 'Incoming busy revision',
    })
    await app.vault.modify(app.vault.getFileByPath(copy)!, incoming)
    await AgentsService.getInstance().updateFile(app.vault.getFileByPath(copy)!)
    expect(session.commentId).toBe('sample-copy-a')
    await session.save()
    expect(await app.vault.read(app.vault.getFileByPath(copy)!)).toBe(incoming)
    expect((await ChatStorage.getInstance().findDiscussion('sample-copy-a'))?.path).toBe(copy)
    restart()
    await ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!)
    const idle = ChatService.getInstance().activeSession.value!
    const source = parseChat(incoming)
    const edited = serializeChat({
      ...source,
      metadata: source.metadata!,
      messages: [
        { id: 'sample-arrival', role: 'assistant', content: 'Concurrent answer', timestamp: 20 },
      ],
    })
    await app.vault.modify(app.vault.getFileByPath(copy)!, edited)
    await idle.save()
    expect(await app.vault.read(app.vault.getFileByPath(copy)!)).toBe(edited)
  })
  it('14 failed normalization publishes no owner; revision races reread; commit survives index loss', async () => {
    const app = fixture()
    const process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('Sample I/O failure'))
    expect(
      await CommentService.getInstance().handOverToTab(id, app.vault.getFileByPath(copy)!)
    ).toBeNull()
    expect((await disk(app, copy)).commentId).toBe(id)
    expect(CommentService.getInstance().sessions.size).toBe(0)
    vi.mocked(app.vault.process).mockImplementationOnce(async (file, change) => {
      await app.vault.modify(file, content({ title: 'Concurrent title' }))
      return process(file, change)
    })
    await Promise.all([
      AgentsService.getInstance().start(),
      ChatService.getInstance().openChatFile(app.vault.getFileByPath(copy)!),
    ])
    const fork = await normalized(app)
    expect((await disk(app, copy)).title).toBe('Concurrent title')
    expect(ChatService.getInstance().activeSession.value?.commentId).toBe(fork)
    restart()
    expect((await CommentService.getInstance().load(fork))?.currentChatFile.value?.path).toBe(copy)
    await marker()
  })
  it('14 a crash after committing metadata but before indexing cannot expose or lose a fork', async () => {
    const app = fixture()
    const storage = ChatStorage.getInstance()
    const paths = (storage as unknown as { discussionPaths: Map<string, unknown> }).discussionPaths
    vi.spyOn(paths, 'set').mockImplementationOnce(() => {
      throw new Error('Sample publication interruption')
    })
    expect(
      await CommentService.getInstance().handOverToTab(id, app.vault.getFileByPath(copy)!)
    ).toBeNull()
    const fork = await normalized(app)
    expect(CommentService.getInstance().sessions.size).toBe(0)
    restart()
    expect((await CommentService.getInstance().load(fork))?.currentChatFile.value?.path).toBe(copy)
    await marker()
  })
  it('15 duplicate self-declared owners and ambiguous legacy files cannot open or delete arbitrary candidates', async () => {
    const app = fixture()
    await app.vault.modify(app.vault.getFileByPath(copy)!, content({ commentLocation: copy }))
    expect(await CommentService.getInstance().load(id)).toBeNull()
    await CommentService.getInstance().remove(id)
    expect(app.vault.getFileByPath(original)).not.toBeNull()
    expect(app.vault.getFileByPath(copy)).not.toBeNull()
    const legacy = await app.vault.create(
      'Archive/sample-legacy.abchat',
      content({ commentId: undefined, commentLocation: undefined })
    )
    expect(await CommentService.getInstance().handOverToTab('sample-legacy', legacy)).toBeNull()
    expect((await disk(app, legacy.path)).commentId).toBeUndefined()
  })
  it.fails(
    '16 BUG: sync intermediate moves need a logical-revision/provenance protocol before publication',
    async () => {
      const app = fixture()
      const file = app.vault.getFileByPath(original)!
      const next = 'Moved/sample-synced.abchat'
      await app.fileManager.renameFile(file, next)
      // No trusted rename event: sync has moved bytes but has not supplied final metadata yet.
      await AgentsService.getInstance().updateFile(file)
      // A sync adapter must keep this pending until its complete logical revision arrives.
      expect((await disk(app, next)).commentId).toBe(id)
    }
  )
  it('16 raw moves without provenance fork, even after deletion of the declared original', async () => {
    const app = fixture()
    const file = app.vault.getFileByPath(original)!
    const next = 'Moved/sample-unproven.abchat'
    await app.fileManager.renameFile(file, next)
    await AgentsService.getInstance().updateFile(file)
    await normalized(app, next)
    expect(await CommentService.getInstance().load(id)).toBeNull()
    await app.vault.modify(file, content({ commentId: id, commentLocation: next }))
    await AgentsService.getInstance().updateFile(file)
    expect((await CommentService.getInstance().load(id))?.currentChatFile.value?.path).toBe(next)
  })
})
