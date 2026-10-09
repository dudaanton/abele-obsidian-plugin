import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ChatLogWriter, parseChat, serializeChat } from '@/ai/ChatLog'
import { acceptRevision } from '@/ai/replyAnnotations'
import { captureChatSelection, resolveChatAnchor } from '@/selection/anchors'
import type { RevisionPorts } from '@/selection/types'
import type { ChatDecorationOperation } from '@/ai/chatAnchorStore'
import { EMPTY_USAGE } from '@/ai/client'

const PATH = 'AI/Chats/sample-anchor.abchat'
const TEXT = 'A lantern beside another lantern.'
let app: ReturnType<typeof useVault>
let session: ChatSession
let counter: number
const ports: RevisionPorts = {
  nextId: () => `sample-id-${++counter}`,
  project: (text) => ({ version: 'plain-v1', text }),
}
const file = () => app.vault.getAbstractFileByPath(PATH) as TFile
const disk = async () => parseChat(await app.vault.read(file()))
const capture = async (start = 2) =>
  captureChatSelection({
    revision: await session.ensureSelectionRevision('reply', ports),
    range: { space: 'rendered', start, end: start + 7 },
    role: 'assistant',
    author: 'Sample agent',
    sentence: TEXT,
    title: 'Sample chat',
    pathHint: PATH,
  })
const reopen = async () => {
  session.destroy()
  session = new ChatSession(ChatService.getInstance())
  await session.load(file())
}

beforeEach(async () => {
  counter = 0
  app = useVault([
    {
      path: PATH,
      content: serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [{ id: 'reply', role: 'assistant', content: TEXT, timestamp: 1 }],
        internalMessages: [
          {
            role: 'assistant',
            chatMessageId: 'reply',
            content: [{ type: 'text', text: TEXT }],
            model: 'sample',
            timestamp: 1,
            usage: EMPTY_USAGE,
            stopReason: 'stop',
          },
        ],
      }),
    },
  ])
  ChatStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(ChatService.getInstance())
  await session.load(file())
})
afterEach(() => session.destroy())

it('keeps delegation parent authority bound to the durable chat identity, not a transient tab ID', async () => {
  const id = await session.ensureDelegationParentId()
  expect(id).toBeTruthy()
  expect(id).not.toBe(session.id)
  expect((await disk()).metadata?.chatId).toBe(id)
  await reopen()
  expect(await session.ensureDelegationParentId()).toBe(id)
  expect(session.delegationParentId).toBe(id)
})

describe('durable selection anchors', () => {
  it.each([1, 2])(
    'lazily initializes identities in format %s and preserves source/history through reopen and compaction',
    async (version) => {
      if (version === 1) {
        const old = await disk()
        await app.vault.modify(
          file(),
          JSON.stringify({
            metadata: old.metadata,
            messages: old.messages,
            internalMessages: old.internalMessages,
          })
        )
        await reopen()
      }
      expect((await disk()).metadata?.chatId).toBeUndefined()
      const history = (await disk()).internalMessages
      const projected = (session as any).getMessagesForModel()
      const first = await capture()
      const second = await capture(25)
      const a = await session.ensureChatAnchor(first, ports.nextId)
      const b = await session.ensureChatAnchor(second, ports.nextId)
      expect(a.id).not.toBe(b.id)
      expect((await session.ensureChatAnchor(first, ports.nextId)).id).toBe(a.id)
      const saved = await disk()
      expect(saved.version).toBe(2)
      expect(saved.metadata?.chatId).toBe(first.source.chatId)
      expect(saved.messages[0].content).toBe(TEXT)
      expect(saved.internalMessages).toEqual(history)
      expect((session as any).getMessagesForModel()).toEqual(projected)
      expect(saved.messages[0].selection?.versions).toHaveLength(1)
      await reopen()
      expect(await session.getAnchor(first.source.chatId, a.id)).toEqual(a)
      expect(await session.getRevision(a.original)).toEqual(
        await session.ensureSelectionRevision('reply', ports)
      )
      for (let i = 0; i < 8; i++) {
        session.chatTitle.value = `Sample title ${i}`
        await session.save()
      }
      expect((await disk()).messages[0].selection).toEqual(saved.messages[0].selection)
      await reopen()
      expect(await session.getAnchor(first.source.chatId, b.id)).toEqual(b)
    }
  )

  it('rejects an anchor id already owned by another message', async () => {
    const first = await capture()
    await session.ensureChatAnchor(first, () => 'sample-collision')
    await session.addUserNote('A different saved message.')
    const messageId = session.messages.value.at(-1)!.id
    const revision = await session.ensureSelectionRevision(messageId, ports)
    const selected = captureChatSelection({
      revision,
      range: { space: 'rendered', start: 2, end: 11 },
      role: 'user',
      author: '',
      sentence: '',
      title: '',
      pathHint: PATH,
    })
    await expect(session.ensureChatAnchor(selected, () => 'sample-collision')).rejects.toThrow(
      /unique/
    )
    expect((await disk()).messages.find((m) => m.id === messageId)?.selection?.anchors).toEqual([])
  })

  it('returns no anchor after a failed or torn checked write, then retries explicitly', async () => {
    const snapshot = await capture()
    const before = await disk()
    const modify = app.vault.modify.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, fn) => {
      const content = fn(await app.vault.read(target))
      await modify(target, content.slice(0, Math.floor(content.length / 2)))
      throw new Error('sample interrupted anchor write')
    })
    await expect(session.ensureChatAnchor(snapshot, ports.nextId)).rejects.toThrow(
      'sample interrupted anchor write'
    )
    expect((await disk()).messages).toEqual(before.messages)
    expect(session.findMessage('reply')?.selection?.anchors).toEqual([])
    await session.save()
    expect((await disk()).messages).toEqual(before.messages)
    await reopen()
    const a = await session.ensureChatAnchor(snapshot, ports.nextId)
    expect(await session.getAnchor(snapshot.source.chatId, a.id)).toEqual(a)
  })

  it('recovers every readable prior record after an anchor rewrite crashes on a reopened torn log', async () => {
    const snapshot = await capture()
    await session.addUserNote('A readable turn before the interrupted append.')
    await app.vault.append(file(), '{"k":"int","role":"user","content":"unfinished')
    await reopen()
    const before = await disk()
    expect(before.torn).toBe(true)
    expect(before.damaged).toBe(1)
    expect(before.messages).toHaveLength(2)
    let recovered: ReturnType<typeof parseChat> | undefined
    let reopenedMessages: typeof before.messages | undefined
    const modify = app.vault.modify.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, fn) => {
      fn(await app.vault.read(target))
      // Crash after truncation: exercise the next open BEFORE the old writer's catch can
      // restore anything. That writer is unavailable to a real post-crash process.
      await modify(target, '')
      const replacement = new ChatSession(ChatService.getInstance())
      try {
        await replacement.load(target)
        recovered = await disk()
        reopenedMessages = replacement.allMessages.value
      } finally {
        replacement.destroy()
      }
      throw new Error('sample crash after anchor rewrite truncation')
    })
    await expect(session.ensureChatAnchor(snapshot, ports.nextId)).rejects.toThrow(
      'sample crash after anchor rewrite truncation'
    )
    expect(recovered?.metadata).toEqual(before.metadata)
    expect(recovered?.messages).toEqual(before.messages)
    expect(reopenedMessages).toEqual(before.messages)
    expect(recovered?.internalMessages).toEqual(before.internalMessages)
    expect(recovered?.torn).toBe(false)
    expect(recovered?.damaged).toBe(0)
    expect(session.findMessage('reply')?.selection?.anchors).toEqual([])
  })

  it('does not publish lazy identities if their initial save fails', async () => {
    vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('sample identity failure'))
    await expect(session.ensureSelectionRevision('reply', ports)).rejects.toThrow(
      'sample identity failure'
    )
    expect((await disk()).metadata?.chatId).toBeUndefined()
    expect(session.findMessage('reply')?.selection).toBeUndefined()
  })

  it('refuses stale external data, including a change during safety copying', async () => {
    const snapshot = await capture()
    const write = app.vault.adapter.write.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'write').mockImplementationOnce(async (path, content) => {
      await write(path, content)
      const external = await disk()
      external.messages[0].content = 'An independently updated reply.'
      await app.vault.modify(file(), serializeChat({ ...external, metadata: external.metadata! }))
    })
    await expect(session.ensureChatAnchor(snapshot, ports.nextId)).rejects.toThrow(
      /changed elsewhere/
    )
    expect((await disk()).messages[0].content).toBe('An independently updated reply.')
    expect((await disk()).messages[0].selection?.anchors).toEqual([])
  })

  it('serializes simultaneous anchors and preserves new turn events during their write', async () => {
    const first = await capture()
    const second = await capture(25)
    session.isStreaming.value = true
    const process = app.vault.process.bind(app.vault)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spy = vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, fn) => {
      await gate
      return process(target, fn)
    })
    const adding = session.ensureChatAnchor(first, ports.nextId)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    ;(session as any).handleAgentEvent({
      type: 'tool_start',
      toolCallId: 'sample-tool',
      toolName: 'read',
      args: { path: 'sample.md' },
    })
    ;(session as any).allInternalMessages.push({
      role: 'user',
      content: 'A concurrent turn.',
      timestamp: 2,
      chatMessageId: 'reply',
    })
    const saving = session.save()
    const other = session.ensureChatAnchor(second, ports.nextId)
    release()
    await Promise.all([adding, saving, other])
    await session.save()
    expect((await disk()).messages[0].selection?.anchors).toHaveLength(2)
    expect((await disk()).messages.some((m) => m.toolCallId === 'sample-tool')).toBe(true)
    expect(
      (await disk()).internalMessages.some(
        (m) => m.role === 'user' && m.content === 'A concurrent turn.'
      )
    ).toBe(true)
    session.isStreaming.value = false
  })

  it('does not retarget revision preparation across an equal-text semantic edit while waiting for the writer', async () => {
    await capture()
    const process = app.vault.process.bind(app.vault)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spy = vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, fn) => {
      await gate
      return process(target, fn)
    })
    const editing = session.changeReply('reply', (message) =>
      acceptRevision(
        message,
        {
          id: 'sample-equal-proposal',
          parent: PATH,
          message: 'reply',
          before: TEXT,
          from: 2,
          old: 'lantern',
          text: 'lantern',
          request: '',
          author: '',
          at: 2,
          status: 'pending',
        },
        3
      )
    )
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    const preparing = session.ensureSelectionRevision('reply', ports)
    const refused = expect(preparing).rejects.toThrow(/changed/)
    release()
    await editing
    await refused
    expect((await disk()).messages[0].content).toBe(TEXT)
  })

  it('rejects draft and streaming targets without blocking annotations on saved messages', async () => {
    session.isStreaming.value = true
    session.streamingContent.value = 'An unfinished answer.'
    await expect(session.ensureSelectionRevision('streaming', ports)).rejects.toThrow(/saved/)
    ;(session as any).appendChatMessage({
      id: 'draft',
      role: 'user',
      content: 'Draft',
      timestamp: 2,
      draft: true,
    })
    await expect(session.ensureSelectionRevision('draft', ports)).rejects.toThrow(/saved/)
    await session.ensureChatAnchor(await capture(), ports.nextId)
    await session.highlightReply('reply', 'lantern', 2)
    session.isStreaming.value = false
    await session.save()
  })

  it.each([false, true])(
    'keeps historical source and undo identity with parent closed=%s',
    async (closed) => {
      const snapshot = await capture()
      const a = await session.ensureChatAnchor(snapshot, ports.nextId)
      const proposal = {
        id: 'sample-proposal',
        parent: PATH,
        message: 'reply',
        before: TEXT,
        from: 2,
        old: 'lantern',
        text: 'lamp',
        request: 'Rewrite the passage.',
        author: 'Sample agent',
        at: 2,
        status: 'pending' as const,
      }
      if (closed) {
        const saved = await disk()
        saved.messages[0] = acceptRevision(saved.messages[0], proposal, 3)
        await app.vault.modify(file(), serializeChat({ ...saved, metadata: saved.metadata! }))
        await reopen()
      } else await session.changeReply('reply', (m) => acceptRevision(m, proposal, 3))
      const current = await session.ensureSelectionRevision('reply', ports)
      expect(current.reference.revisionId).not.toBe(snapshot.source.revisionId)
      await expect(session.ensureChatAnchor(snapshot, ports.nextId)).rejects.toThrow(/changed/)
      expect(
        resolveChatAnchor(a, current.reference, (await disk()).messages[0].selection!.versions)
          .status
      ).toBe('historical')
      await session.undoReplyRevision('reply')
      await reopen()
      expect((await session.ensureSelectionRevision('reply', ports)).reference).toEqual(a.original)
      expect((await disk()).messages[0].content).toBe(TEXT)
    }
  )

  it('shares ancestor anchors between branches but not new user messages or regenerated replies', async () => {
    const snapshot = await capture()
    const a = await session.ensureChatAnchor(snapshot, ports.nextId)
    await session.addUserNote('A new descendant.')
    session.createBranch('reply')
    await session.addUserNote('Another descendant.')
    ;(session as any).handleAgentEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: TEXT }],
        model: 'sample',
        usage: EMPTY_USAGE,
        stopReason: 'stop',
      },
    })
    await session.save()
    const saved = await disk()
    expect(saved.messages.filter((m) => m.id !== 'reply').every((m) => !m.selection)).toBe(true)
    expect(await session.getAnchor(snapshot.source.chatId, a.id)).toEqual(a)
    await reopen()
    expect(await session.getAnchor(snapshot.source.chatId, a.id)).toEqual(a)
  })

  it('preserves added fields with an older pass-through writer, but cannot preserve what an older schema writer drops', async () => {
    const snapshot = await capture()
    const anchor = await session.ensureChatAnchor(snapshot, ports.nextId)
    const saved = await disk()
    // The existing v2 codec carries arbitrary fields when passed through unchanged.
    await app.vault.modify(
      file(),
      serializeChat({ ...saved, metadata: { ...saved.metadata!, title: 'Older client title' } })
    )
    await reopen()
    expect(await session.getAnchor(snapshot.source.chatId, anchor.id)).toEqual(anchor)
    const roundTrip = await disk()
    // A historical client rebuilding its known metadata/message schema has no such promise.
    delete roundTrip.metadata!.chatId
    delete roundTrip.messages[0].selection
    await app.vault.modify(file(), serializeChat({ ...roundTrip, metadata: roundTrip.metadata! }))
    await reopen()
    expect(await session.getAnchor(snapshot.source.chatId, anchor.id)).toBeUndefined()
    const fresh = await session.ensureSelectionRevision('reply', ports)
    expect(fresh.reference.chatId).not.toBe(snapshot.source.chatId)
    expect((await disk()).messages[0].content).toBe(TEXT)
  })

  it('retains passive decoration evidence and unresolved recovery through normal saves, anchor writes and compaction', async () => {
    const snapshot = await capture()
    const anchor = await session.ensureChatAnchor(snapshot, ports.nextId)
    const saved = await disk()
    const operation: ChatDecorationOperation = {
      id: 'sample-operation',
      bindingId: 'sample-binding',
      anchorId: anchor.id,
      targetPath: 'Cards/sample.md',
      captured: anchor.original,
      patch: {
        range: { space: 'source', start: 2, end: 9 },
        before: 'lantern',
        after: '[[Cards/sample|lantern]]',
      },
      resulting: { ...anchor.original, revisionId: 'sample-result-version' },
    }
    saved.messages[0].decorationOperations = [operation]
    saved.metadata!.bindingRecovery = [
      {
        operation,
        status: 'uncertain',
        targetPath: 'Cards/sample.md',
        evidence: 'sample-write-evidence',
      },
    ]
    await app.vault.modify(file(), serializeChat({ ...saved, metadata: saved.metadata! }))
    await reopen()
    await session.ensureChatAnchor(snapshot, ports.nextId)
    for (let i = 0; i < 10; i++) {
      session.chatTitle.value = `Sample retained title ${i}`
      await session.save()
    }
    const compacted = await disk()
    expect(compacted.records).toBeLessThan(10)
    expect(compacted.metadata!.bindingRecovery).toEqual(saved.metadata!.bindingRecovery)
    expect(compacted.messages[0].decorationOperations).toEqual([operation])
    expect(compacted.messages[0].selection?.versions).toEqual(saved.messages[0].selection?.versions)
    expect(compacted.messages[0].content).toBe(TEXT)
    expect(compacted.internalMessages).toEqual(saved.internalMessages)
    await reopen()
    expect((await disk()).metadata!.bindingRecovery).toEqual(saved.metadata!.bindingRecovery)
  })

  it('retains anchors before a torn append and does not duplicate source per anchor', async () => {
    const snapshot = await capture()
    await session.ensureChatAnchor(snapshot, ports.nextId)
    const saved = await disk()
    const writer = new ChatLogWriter()
    writer.adopt(saved)
    const state = { ...saved, metadata: { ...saved.metadata!, title: 'New title' } }
    const plan = writer.plan(state)
    expect(plan.kind).toBe('append')
    if (plan.kind === 'append') await app.vault.append(file(), plan.data + '{"k":"msg","id":"torn')
    await reopen()
    expect((await disk()).messages[0].selection?.anchors).toHaveLength(1)
    const source = 'x'.repeat(50_000) + ' word'
    await session.addUserNote(source)
    const id = session.messages.value.at(-1)!.id
    const revision = await session.ensureSelectionRevision(id, ports)
    const before = (await app.vault.read(file())).length
    for (let i = 0; i < 40; i++) {
      const selected = captureChatSelection({
        revision,
        range: { space: 'rendered', start: i, end: i + 1 },
        role: 'user',
        author: '',
        sentence: '',
        title: '',
        pathHint: PATH,
      })
      await session.ensureChatAnchor(selected, ports.nextId)
    }
    const growth = (await app.vault.read(file())).length - before
    expect(growth).toBeLessThan(60_000)
    expect((await disk()).messages.find((m) => m.id === id)?.selection?.versions).toHaveLength(1)
    console.info(`40 anchors on one 50KB revision add ${growth} UTF-16 units`)
  })
})
