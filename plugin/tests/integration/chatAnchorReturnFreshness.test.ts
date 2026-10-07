import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice, type TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, serializeChat, type ChatSnapshot } from '@/ai/ChatLog'
import { chatCopyPath, readChat, rewriteChat } from '@/ai/chatCopy'
import { captureChatSelection, createChatAnchor } from '@/selection/anchors'
import { captureSelectionLink, openSelectionLink } from '@/ai/openChat'
import * as commentEvents from '@/editor/CommentPlugin'

const PATH = 'Chats/sample-return.abchat'
function snapshot(chatId = 'sample-chat'): ChatSnapshot {
  const revision = {
    reference: { chatId, messageId: 'reply', revisionId: 'original' },
    content: 'repeat repeat',
    projection: { version: 'chat-text-v1', text: 'repeat repeat' },
  }
  const capture = captureChatSelection({
    revision,
    range: { space: 'rendered', start: 7, end: 13 },
    sentence: revision.content,
    role: 'assistant',
    author: 'assistant',
    title: 'Sample',
    pathHint: PATH,
  })
  const anchor = createChatAnchor(capture, revision, () => 'sample-anchor')
  return {
    metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '', chatId },
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        timestamp: 1,
        content: revision.content,
        selection: { revisionId: 'original', versions: [revision], anchors: [anchor] },
      },
    ],
    internalMessages: [],
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let app: ReturnType<typeof useVault>
let service: ChatService
const file = (path = PATH) => app.vault.getAbstractFileByPath(path) as TFile
beforeEach(() => {
  app = useVault([{ path: PATH, content: serializeChat(snapshot()) }])
  ChatStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], chatHistory: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  service = ChatService.getInstance()
  vi.spyOn(commentEvents, 'dispatchCommentsChanged').mockImplementation(() => {})
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue()
  service.pendingAnchorReturn.value = null
})
afterEach(() => {
  CommentService.getInstance().destroy()
  service.destroy()
  vi.restoreAllMocks()
})

describe('returning through an already-open chat after an external write', () => {
  it('reconciles a nested discussion already owned by the comment service', async () => {
    const comments = CommentService.getInstance()
    const nested = comments.commentPath('sample-linked')
    const data = snapshot('nested-chat')
    data.metadata = { ...data.metadata, kind: 'comment', anchor: { note: PATH, message: 'reply' } }
    await app.vault.create(nested, serializeChat(data))
    await comments.showInSidebar('sample-linked')
    const session = service.activeSession.value
    data.messages[0].selection!.anchors = [
      ...data.messages[0].selection!.anchors,
      { ...data.messages[0].selection!.anchors[0], id: 'remote-anchor' },
    ]
    await app.vault.modify(file(nested), serializeChat(data))
    await openSelectionLink(`${nested}#abele-selection=nested-chat/remote-anchor`)
    expect(service.activeSession.value).toBe(session)
    expect(service.pendingAnchorReturn.value?.target.anchor.id).toBe('remote-anchor')
  })
  it('resolves a newly synced anchor without saving stale session records or losing its draft', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    session.draft.value = { text: 'An unsent thought.', attachments: [] }
    const draft = session.draft.value
    const newer = snapshot()
    const selection = newer.messages[0].selection!
    selection.anchors = [...selection.anchors, { ...selection.anchors[0], id: 'remote-anchor' }]
    const text = serializeChat(newer)
    await app.vault.modify(file(), text)
    await openSelectionLink(`${PATH}#abele-selection=sample-chat/remote-anchor`)
    expect(service.pendingAnchorReturn.value?.target.anchor.id).toBe('remote-anchor')
    expect(session.draft.value).toBe(draft)
    expect(await app.vault.read(file())).toBe(text)
  })
  it('keeps a containing active branch rather than adopting the remote branch choice', async () => {
    const data = snapshot()
    data.messages.push(
      { id: 'tail-a', parentId: 'reply', role: 'user', content: 'First branch.', timestamp: 2 },
      { id: 'tail-b', parentId: 'reply', role: 'user', content: 'Second branch.', timestamp: 3 }
    )
    data.metadata.activeLeafId = 'tail-a'
    await app.vault.modify(file(), serializeChat(data))
    await service.openChatFile(file())
    data.metadata.activeLeafId = 'tail-b'
    data.messages[0].selection!.anchors = [
      ...data.messages[0].selection!.anchors,
      { ...data.messages[0].selection!.anchors[0], id: 'remote-anchor' },
    ]
    await app.vault.modify(file(), serializeChat(data))
    await openSelectionLink(`${PATH}#abele-selection=sample-chat/remote-anchor`)
    expect(service.pendingAnchorReturn.value?.target.leafId).toBe('tail-a')
    expect(service.getSessionByFile(PATH)?.messages.value.map((message) => message.id)).toEqual([
      'reply',
      'tail-a',
    ])
  })
  it('does not replace local in-flight work or expose a stale highlight on an external conflict', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    session.isStreaming.value = true
    const data = snapshot()
    data.messages[0].content = 'Externally changed reply.'
    const text = serializeChat(data)
    await app.vault.modify(file(), text)
    try {
      await openSelectionLink(`${PATH}#abele-selection=sample-chat/sample-anchor`)
      expect(service.pendingAnchorReturn.value).toBeNull()
      expect(session.messages.value[0].content).toBe('repeat repeat')
      expect(session.isStreaming.value).toBe(true)
      expect(await app.vault.read(file())).toBe(text)
    } finally {
      session.isStreaming.value = false
    }
  })
  it('resolves an externally edited reply historically instead of highlighting its cached current text', async () => {
    await service.openChatFile(file())
    const newer = snapshot()
    newer.messages[0] = {
      ...newer.messages[0],
      content: 'repeat changed repeat',
      selection: { ...newer.messages[0].selection!, revisionId: 'edited' },
    }
    await app.vault.modify(file(), serializeChat(newer))
    await openSelectionLink(`${PATH}#abele-selection=sample-chat/sample-anchor`)
    expect(service.pendingAnchorReturn.value?.target.resolution.status).toBe('historical')
    expect(service.getSessionByFile(PATH)?.messages.value[0].content).toBe('repeat changed repeat')
  })
})

describe('read-only selection return reconciliation', () => {
  it.each([
    ['empty', 'highlight'],
    ['empty', 'copy-link'],
    ['torn', 'highlight'],
    ['torn', 'copy-link'],
    ['unterminated', 'highlight'],
    ['unterminated', 'copy-link'],
  ] as const)(
    'keeps the backup intact after a selection return followed by %s-main %s',
    async (damage, action) => {
      await service.openChatFile(file())
      const session = service.getSessionByFile(PATH)!
      const messages = session.allMessages.value
      const next = snapshot()
      next.metadata.title = 'Backup-only title'
      const selection = next.messages[0].selection!
      selection.anchors.push({ ...selection.anchors[0], id: 'backup-only-anchor' })
      const content = serializeChat(next)
      const backup = chatCopyPath(app as never, PATH)
      const raw = `${PATH}\n${content}`
      await app.vault.adapter.write(backup, raw)
      const torn =
        damage === 'empty'
          ? ''
          : damage === 'torn'
            ? content.slice(0, content.indexOf('\n') + 20)
            : serializeChat(snapshot()).trimEnd()
      await app.vault.modify(file(), torn)
      await openSelectionLink(`${PATH}#abele-selection=sample-chat/sample-anchor`)
      expect(service.pendingAnchorReturn.value?.target.anchor.id).toBe('sample-anchor')
      const write = vi.spyOn(app.vault.adapter, 'write')
      const remove = vi.spyOn(app.vault.adapter, 'remove')
      const change =
        action === 'highlight'
          ? session.highlightReply('reply', 'repeat', 7)
          : captureSelectionLink(session, 'reply', 'repeat', 7, 'repeat repeat')()
      await expect(change).rejects.toThrow(/Reopen/)
      expect(await app.vault.adapter.exists(backup)).toBe(true)
      expect(await app.vault.adapter.read(backup)).toBe(raw)
      expect(await app.vault.read(file())).toBe(torn)
      expect(session.allMessages.value).toBe(messages)
      expect(write).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    }
  )
  it('asks to reopen when the requested anchor exists only in a damaged file’s backup', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    const messages = session.allMessages.value
    const next = snapshot()
    const selection = next.messages[0].selection!
    selection.anchors.push({ ...selection.anchors[0], id: 'backup-only-anchor' })
    const backup = chatCopyPath(app as never, PATH)
    const raw = `${PATH}\n${serializeChat(next)}`
    await app.vault.adapter.write(backup, raw)
    await app.vault.modify(file(), '')
    const notices = Notice.shown.length
    await openSelectionLink(`${PATH}#abele-selection=sample-chat/backup-only-anchor`)
    expect(service.pendingAnchorReturn.value).toBeNull()
    expect(Notice.shown.slice(notices).join(' ')).toMatch(/reopen/i)
    expect(session.allMessages.value).toBe(messages)
    expect(await app.vault.adapter.read(backup)).toBe(raw)
    expect(await app.vault.read(file())).toBe('')
  })
  it('preserves a safety copy created after its read starts when the rewrite crashes after truncation', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    const reading = deferred(),
      releaseRead = deferred(),
      copied = deferred(),
      crash = deferred()
    const read = app.vault.read.bind(app.vault)
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async (file) => {
      const text = await read(file)
      reading.resolve()
      await releaseRead.promise
      return text
    })
    const returning = session.reconcileForSelectionReturn()
    await reading.promise
    const next = snapshot()
    next.messages[0].content = 'The rewritten reply.'
    const content = serializeChat(next)
    const backup = chatCopyPath(app as never, PATH)
    const modify = app.vault.modify.bind(app.vault)
    vi.spyOn(app.vault, 'modify').mockImplementationOnce(async () => {
      copied.resolve()
      await crash.promise
      await modify(file(), '')
      throw new Error('Interrupted rewrite')
    })
    const writing = rewriteChat(app as never, file(), content).catch(
      (error: Error) => error.message
    )
    await copied.promise
    try {
      expect(await app.vault.adapter.read(backup)).toBe(`${PATH}\n${content}`)
      releaseRead.resolve()
      await returning
    } finally {
      releaseRead.resolve()
      crash.resolve()
      expect(await writing).toBe('Interrupted rewrite')
    }
    expect(await read(file())).toBe('')
    expect(await app.vault.adapter.exists(backup)).toBe(true)
    expect(await app.vault.adapter.read(backup)).toBe(`${PATH}\n${content}`)
    // Only the ordinary recovery path repairs the interrupted rewrite on reopen.
    expect((await readChat(app as never, file())).messages[0].content).toBe('The rewritten reply.')
    expect(await read(file())).toBe(content)
  })
  it.each(['empty', 'unterminated', 'damaged'] as const)(
    'ignores a %s main snapshot without consulting backups or disturbing an in-flight session',
    async (damage) => {
      await service.openChatFile(file())
      const session = service.getSessionByFile(PATH)!
      const messages = session.allMessages.value
      const title = session.chatTitle.value
      const next = snapshot()
      next.metadata.title = 'Uncommitted title'
      const content = serializeChat(next)
      const text =
        damage === 'empty'
          ? ''
          : damage === 'unterminated'
            ? content.trimEnd()
            : content + '{bad}\n'
      await app.vault.modify(file(), text)
      const exists = vi.spyOn(app.vault.adapter, 'exists')
      const read = vi.spyOn(app.vault.adapter, 'read')
      session.isStreaming.value = true
      try {
        await session.reconcileForSelectionReturn()
        expect(session.allMessages.value).toBe(messages)
        expect(session.chatTitle.value).toBe(title)
        expect(session.isStreaming.value).toBe(true)
        expect(exists).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        expect(await app.vault.read(file())).toBe(text)
      } finally {
        session.isStreaming.value = false
      }
    }
  )
  it('leaves a torn chat and its safety copy alone without adopting recovered state', async () => {
    await service.openChatFile(file())
    const next = snapshot()
    next.messages[0].content = 'Recovered reply.'
    const backup = chatCopyPath(app as never, PATH)
    const raw = `${PATH}\n${serializeChat(next)}`
    await app.vault.adapter.write(backup, raw)
    await app.vault.modify(file(), '')
    const modify = vi.spyOn(app.vault, 'modify')
    const remove = vi.spyOn(app.vault.adapter, 'remove')
    await service.getSessionByFile(PATH)!.reconcileForSelectionReturn()
    expect(service.getSessionByFile(PATH)!.messages.value[0].content).toBe('repeat repeat')
    expect(await app.vault.read(file())).toBe('')
    expect(await app.vault.adapter.read(backup)).toBe(raw)
    expect(modify).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
  it.each([
    ['empty', 'cached'],
    ['empty', 'changed'],
    ['torn', 'cached'],
    ['torn', 'changed'],
  ] as const)(
    'leaves a damaged (%s) main file and %s backup state unchanged until reopen recovers every record',
    async (damage, state) => {
      const next = snapshot()
      next.messages.push(
        { id: 'follow-up', parentId: 'reply', role: 'user', timestamp: 2, content: 'Follow-up.' },
        { id: 'answer', parentId: 'follow-up', role: 'assistant', timestamp: 3, content: 'Answer.' }
      )
      next.internalMessages = [
        { role: 'user', content: 'Internal question.' },
        { role: 'assistant', content: 'Internal answer.' },
      ]
      await app.vault.modify(file(), serializeChat(next))
      await service.openChatFile(file())
      const session = service.getSessionByFile(PATH)!
      const messages = session.allMessages.value
      if (state === 'changed') next.messages[2].content = 'Recovered answer.'
      const content = serializeChat(next)
      const backup = chatCopyPath(app as never, PATH)
      const raw = `${PATH}\n${content}`
      await app.vault.adapter.write(backup, raw)
      const torn = damage === 'empty' ? '' : content.slice(0, content.indexOf('\n') + 20)
      await app.vault.modify(file(), torn)
      await session.reconcileForSelectionReturn()
      expect(session.allMessages.value).toBe(messages)
      expect(await app.vault.read(file())).toBe(torn)
      expect(await app.vault.adapter.read(backup)).toBe(raw)

      // Recovery belongs to an ordinary open, not reconciliation or a deferred rewrite flag.
      const reopened = new ChatSession(service)
      try {
        await reopened.load(file())
        expect(reopened.allMessages.value).toEqual(next.messages)
        expect(await app.vault.read(file())).toBe(content)
        expect(await app.vault.adapter.exists(backup)).toBe(false)
        const append = vi.spyOn(app.vault, 'append')
        const rewrite = vi.spyOn(app.vault, 'modify')
        reopened.chatTitle.value = 'Saved after recovery'
        await reopened.save()
        const main = parseChat(await app.vault.read(file()))
        expect(main.messages).toEqual(next.messages)
        expect(main.internalMessages).toEqual(next.internalMessages)
        expect(main.damaged).toBe(0)
        expect(main.torn).toBe(false)
        expect(append).toHaveBeenCalledOnce()
        expect(rewrite).not.toHaveBeenCalled()
        expect((await ChatStorage.getInstance().loadChat(file())).internalMessages).toEqual(
          next.internalMessages
        )
      } finally {
        reopened.destroy()
      }
    }
  )
  it('does not persist migrations while restoring an externally replaced flat conversation', async () => {
    await service.openChatFile(file())
    const next = snapshot()
    next.messages.push({ id: 'tail', role: 'user', timestamp: 2, content: 'A flat follow-up.' })
    const text = serializeChat(next)
    await app.vault.modify(file(), text)
    const save = vi.spyOn(ChatStorage.getInstance(), 'saveChat')
    await service.getSessionByFile(PATH)!.reconcileForSelectionReturn()
    expect(service.getSessionByFile(PATH)!.allMessages.value[1].parentId).toBe('reply')
    expect(await app.vault.read(file())).toBe(text)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('local changes while a return snapshot is being read', () => {
  it('does not restore the old reply after a local edit finishes its write during the read', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    const started = deferred(),
      release = deferred()
    const storage = ChatStorage.getInstance(),
      load = storage.loadChat.bind(storage)
    const read = app.vault.read.bind(app.vault)
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async (file) => {
      const text = await read(file)
      started.resolve()
      await release.promise
      return text
    })
    const returning = session.reconcileForSelectionReturn().then(
      () => 'ready',
      (error: Error) => error.message
    )
    await started.promise
    try {
      await session.changeReply('reply', (message) => ({
        ...message,
        content: 'A locally revised answer.',
        selection: { ...message.selection!, revisionId: 'local-edit' },
      }))
    } finally {
      release.resolve()
    }
    const outcome = await returning
    expect(session.messages.value[0].content).toBe('A locally revised answer.')
    expect(outcome).toContain('changed while returning')
    expect((await load(file())).messages[0].content).toBe('A locally revised answer.')
    await session.reconcileForSelectionReturn()
    expect(session.messages.value[0].content).toBe('A locally revised answer.')
  })
  it('keeps an unsaved local setting changed during a read of an external snapshot', async () => {
    await service.openChatFile(file())
    const session = service.getSessionByFile(PATH)!
    const data = snapshot()
    data.messages[0].content = 'A remote revision.'
    await app.vault.modify(file(), serializeChat(data))
    const started = deferred(),
      release = deferred()
    const read = app.vault.read.bind(app.vault)
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async (file) => {
      const text = await read(file)
      started.resolve()
      await release.promise
      return text
    })
    const returning = session.reconcileForSelectionReturn().then(
      () => 'ready',
      (error: Error) => error.message
    )
    await started.promise
    session.customSystemPrompt.value = 'Unsaved local instructions.'
    release.resolve()
    const outcome = await returning
    expect(session.customSystemPrompt.value).toBe('Unsaved local instructions.')
    expect(outcome).toContain('changed while returning')
  })
})

describe('last selection return request wins before tab activation', () => {
  it.each(['chat', 'comment'] as const)(
    'does not activate a slow earlier %s after a newer return is shown',
    async (kind) => {
      const earlier =
        kind === 'chat' ? PATH : CommentService.getInstance().commentPath('sample-nested')
      if (kind === 'comment') {
        const data = snapshot()
        data.metadata = {
          ...data.metadata,
          kind: 'comment',
          anchor: { note: PATH, message: 'reply' },
        }
        await app.vault.create(earlier, serializeChat(data))
        await app.vault.delete(file())
      }
      const later = 'Chats/sample-later.abchat'
      await app.vault.create(later, serializeChat(snapshot('later-chat')))
      const started = deferred(),
        release = deferred()
      const load = ChatSession.prototype.load
      vi.spyOn(ChatSession.prototype, 'load').mockImplementation(async function (file) {
        if (file.path === earlier) {
          started.resolve()
          await release.promise
        }
        await load.call(this, file)
      })
      const first = openSelectionLink(`${earlier}#abele-selection=sample-chat/sample-anchor`)
      await started.promise
      try {
        await openSelectionLink(`${later}#abele-selection=later-chat/sample-anchor`)
        expect(service.activeSession.value?.currentChatFile.value?.path).toBe(later)
      } finally {
        release.resolve()
        await first
      }
      expect(service.activeSession.value?.currentChatFile.value?.path).toBe(later)
      expect(service.pendingAnchorReturn.value?.target.anchor.original.chatId).toBe('later-chat')
    }
  )
})
