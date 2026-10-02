import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { EMPTY_USAGE } from '@/ai/client'
import { createReplyRevisionTool, REPLY_REVISION_TOOL } from '@/ai/tools/ReplyRevisionTool'
import type { ReplyProposal } from '@/ai/replyAnnotations'
import { revealAnchor } from '@/ai/openChat'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))
const PATH = 'AI/Chats/sample-chat.abchat'
const TEXT = 'A small lantern glows.'
const message: ChatMessage = { id: 'reply', role: 'assistant', content: TEXT, timestamp: 1 }
let app: ReturnType<typeof useVault>
const file = () => app.vault.getAbstractFileByPath(PATH) as TFile
const disk = async () => parseChat(await app.vault.read(file()))
const parent = async () => {
  await ChatService.getInstance().openChatFile(file())
  return ChatService.getInstance().getSessionByFile(PATH)!
}

beforeEach(() => {
  app = useVault([
    {
      path: PATH,
      content: serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [message],
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
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  ChatStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats',
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Sample agent' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  vi.spyOn(ChatService.getInstance(), 'revealSidebar').mockResolvedValue(undefined)
})
afterEach(() => {
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
})

async function propose() {
  const p = await parent()
  const child = (await CommentService.getInstance().createOnMessage(
    p,
    'reply',
    'small lantern',
    2
  ))!
  await child.addUserNote('Please rewrite the selected passage.')
  child.permissionMode.value = 'allow-all'
  const result = await createReplyRevisionTool(child).execute('proposal', {
    text: 'bright lamp',
    request: 'Please rewrite the selected passage.',
  })
  return { p, child, proposal: (result.details as { replyProposal: ReplyProposal }).replyProposal }
}

async function stagedProposal() {
  const setup = await propose()
  const { child, proposal } = setup
  ;(child as any).handleAgentEvent({
    type: 'tool_start',
    toolCallId: 'sample-tool',
    toolName: REPLY_REVISION_TOOL,
    args: {},
  })
  ;(child as any).handleAgentEvent({
    type: 'tool_end',
    toolCallId: 'sample-tool',
    result: { content: [], details: { replyProposal: proposal } },
    isError: false,
  })
  await child.save()
  const id = child.messages.value.find((m) => m.replyProposal)!.id
  return { ...setup, id }
}

describe('reply annotation persistence and owner decisions', () => {
  it('returns from a comment to its recorded selected passage rather than just the message id', async () => {
    const { child } = await propose()
    await revealAnchor(child.commentId!, child.anchor.value!)
    expect(ChatService.getInstance().pendingReveal.value).toBe('reply')
    expect(ChatService.getInstance().pendingPassage.value).toEqual({ path: PATH, message: 'reply', quote: 'small lantern', start: 2 })
  })
  it('does not apply a proposal rejected by sync before the local decision', async () => {
    const { child, id } = await stagedProposal()
    const own = child.currentChatFile.value!
    const parsed = parseChat(await app.vault.read(own))
    parsed.messages.find((m) => m.id === id)!.replyProposal!.status = 'rejected'
    await app.vault.modify(own, serializeChat({ ...parsed, metadata: parsed.metadata! }))
    await expect(child.decideReplyProposal(id, true)).rejects.toThrow(/changed|pending/)
    expect((await disk()).messages[0].content).toBe(TEXT)
  })

  it('does not touch the parent when the initial child decision write fails', async () => {
    const { child, id } = await stagedProposal()
    const process = app.vault.process.bind(app.vault)
    vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
      if (file.path === child.currentChatFile.value!.path)
        throw new Error('sample child write failure')
      return process(file, fn)
    })
    await expect(child.decideReplyProposal(id, true)).rejects.toThrow('sample child write failure')
    expect((await disk()).messages[0].content).toBe(TEXT)
  })

  it('persists acceptance before application, refuses a later Reject and resumes after a parent write failure', async () => {
    const { child, id } = await stagedProposal()
    const process = app.vault.process.bind(app.vault)
    const spy = vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
      if (file.path === PATH) throw new Error('sample parent write failure')
      return process(file, fn)
    })
    await expect(child.decideReplyProposal(id, true)).rejects.toThrow('sample parent write failure')
    expect(child.messages.value.find((m) => m.id === id)!.replyProposal).toMatchObject({
      status: 'accepted',
      application: 'pending',
    })
    await expect(child.decideReplyProposal(id, false)).rejects.toThrow(/accepted/)
    spy.mockRestore()
    await child.decideReplyProposal(id, true)
    expect((await disk()).messages[0].content).toBe('A bright lamp glows.')
    expect(child.messages.value.find((m) => m.id === id)!.replyProposal).toMatchObject({
      status: 'accepted',
      application: 'done',
    })
  })

  it('recovers idempotently if recording the completed application in the child fails', async () => {
    const { child, id } = await stagedProposal()
    const process = app.vault.process.bind(app.vault)
    let ownWrites = 0
    const spy = vi.spyOn(app.vault, 'process').mockImplementation(async (file, fn) => {
      if (file.path === child.currentChatFile.value!.path && ++ownWrites === 2)
        throw new Error('sample final child failure')
      return process(file, fn)
    })
    await expect(child.decideReplyProposal(id, true)).rejects.toThrow('sample final child failure')
    expect((await disk()).messages[0].content).toBe('A bright lamp glows.')
    await expect(child.decideReplyProposal(id, false)).rejects.toThrow(/accepted/)
    spy.mockRestore()
    await child.decideReplyProposal(id, true)
    expect((await disk()).messages[0].revisions).toHaveLength(1)
  })
  it.each([false, true])(
    'follows a proposed parent rename with comment unloaded=%s',
    async (unloaded) => {
      const { child, id } = await stagedProposal()
      const ownPath = child.currentChatFile.value!.path
      if (unloaded) {
        CommentService.getInstance().destroy()
        ChatService.getInstance().destroy()
      }
      const next = 'AI/Chats/sample-moved.abchat'
      await app.vault.rename(file(), next)
      await CommentService.getInstance().handleRename(PATH, next)
      const own = app.vault.getAbstractFileByPath(ownPath) as TFile
      const parsed = parseChat(await app.vault.read(own))
      expect(parsed.metadata?.anchor?.note).toBe(next)
      expect(parsed.messages.find((m) => m.id === id)?.replyProposal?.parent).toBe(next)
      const session = unloaded ? (await CommentService.getInstance().load(own.basename))! : child
      await session.decideReplyProposal(id, true)
      expect(
        parseChat(await app.vault.read(app.vault.getAbstractFileByPath(next) as TFile)).messages[0]
          .content
      ).toBe('A bright lamp glows.')
    }
  )

  it('annotates a legacy chat safely and migrates its snapshot without another turn', async () => {
    const old = await disk()
    await app.vault.modify(
      file(),
      JSON.stringify({
        metadata: old.metadata,
        messages: old.messages,
        internalMessages: old.internalMessages,
      })
    )
    const p = await parent()
    await p.highlightReply('reply', 'small', 2, 'yellow')
    expect((await disk()).version).toBe(2)
    expect((await disk()).messages[0].highlights?.[0].quote).toBe('small')
  })

  it.each(['streaming', 'tool', 'approval'] as const)(
    'adds, recolours and removes highlights during %s without changing provider history',
    async (state) => {
      const p = await parent()
      if (state === 'streaming') p.isStreaming.value = true
      if (state === 'tool') p.isExecutingTool.value = true
      if (state === 'approval')
        p.pendingToolCalls.value = [{ id: 'sample-call', name: 'read', arguments: {} }]
      const history = (await disk()).internalMessages
      await p.highlightReply('reply', 'small', 2, 'yellow')
      const mark = p.messages.value[0].highlights![0]
      await p.save()
      expect((await disk()).messages[0].highlights).toEqual([mark])
      await p.recolorReplyHighlight('reply', mark.id, 'purple')
      await p.save()
      expect((await disk()).messages[0].highlights).toEqual([{ ...mark, color: 'purple' }])
      await p.removeReplyHighlight('reply', mark.id)
      await p.save()
      expect((await disk()).messages[0].highlights).toEqual([])
      expect((await disk()).internalMessages).toEqual(history)
      p.isStreaming.value = p.isExecutingTool.value = false
      p.pendingToolCalls.value = []
      await ChatService.getInstance().closeTab(p.id)
      expect((await parent()).messages.value[0].highlights).toEqual([])
    }
  )

  it('serializes annotations with an in-flight save and keeps new turn events during the annotation write', async () => {
    const p = await parent()
    p.isStreaming.value = true
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const append = app.vault.append.bind(app.vault)
    const appendSpy = vi.spyOn(app.vault, 'append').mockImplementationOnce(async (file, data) => {
      await gate
      return append(file, data)
    })
    p.chatTitle.value = 'Sample running turn'
    const saving = p.save()
    await vi.waitFor(() => expect(appendSpy).toHaveBeenCalled())
    const adding = p.highlightReply('reply', 'small', 2, 'yellow')
    release()
    await Promise.all([saving, adding])
    const mark = p.messages.value[0].highlights![0]
    const process = app.vault.process.bind(app.vault)
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const processSpy = vi.spyOn(app.vault, 'process').mockImplementationOnce(async (file, fn) => {
      await writeGate
      return process(file, fn)
    })
    const recoloring = p.recolorReplyHighlight('reply', mark.id, 'green')
    await vi.waitFor(() => expect(processSpy).toHaveBeenCalled())
    ;(p as any).handleAgentEvent({
      type: 'tool_start',
      toolCallId: 'sample-new-tool',
      toolName: 'read',
      args: { path: 'sample.md' },
    })
    const turnSaving = p.save()
    const removing = p.removeReplyHighlight('reply', mark.id)
    releaseWrite()
    await Promise.all([recoloring, turnSaving, removing])
    await p.save()
    expect((await disk()).messages[0].highlights).toEqual([])
    expect((await disk()).messages.some((m) => m.toolCallId === 'sample-new-tool')).toBe(true)
    p.isStreaming.value = false
    await ChatService.getInstance().closeTab(p.id)
    expect((await parent()).messages.value.some((m) => m.toolCallId === 'sample-new-tool')).toBe(
      true
    )
  })

  it('keeps simultaneous highlights and rejects the still-streaming, unsaved answer', async () => {
    const p = await parent()
    p.isStreaming.value = true
    p.streamingContent.value = 'A new answer in progress.'
    await Promise.all([
      p.highlightReply('reply', 'small', 2),
      p.highlightReply('reply', 'lantern', 8),
    ])
    await expect(p.highlightReply('unsaved-reply', 'new answer', 2)).rejects.toThrow(/saved/)
    await p.save()
    expect((await disk()).messages[0].highlights?.map((h) => h.quote)).toEqual(['small', 'lantern'])
    expect((await disk()).messages[0].highlights?.every((h) => h.color === 'yellow')).toBe(true)
    p.isStreaming.value = false
  })

  it('does not publish or retry a highlight whose write failed during a turn', async () => {
    const p = await parent()
    p.isStreaming.value = true
    vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('sample annotation failure'))
    await expect(p.highlightReply('reply', 'small', 2, 'yellow')).rejects.toThrow(
      'sample annotation failure'
    )
    expect(p.messages.value[0].highlights).toBeUndefined()
    await p.save()
    expect((await disk()).messages[0].highlights).toBeUndefined()
    p.isStreaming.value = false
  })

  it('persists colours and removals on the message through reopen', async () => {
    const p = await parent()
    await p.highlightReply('reply', 'small lantern', 2, 'blue')
    expect((await disk()).messages[0].highlights?.[0]).toMatchObject({
      quote: 'small lantern',
      start: 2,
      color: 'blue',
    })
    await ChatService.getInstance().closeTab(p.id)
    const reopened = await parent()
    const mark = reopened.messages.value[0].highlights![0]
    await reopened.removeReplyHighlight('reply', mark.id)
    expect((await disk()).messages[0].highlights).toEqual([])
  })

  it('only proposes even under allow-all; owner acceptance changes the parent and provider history', async () => {
    const { p, child, proposal } = await propose()
    child.permissionMode.value = 'allow-all'
    expect(child.toolDefs().map((t) => t.name)).toContain(REPLY_REVISION_TOOL)
    expect((await disk()).messages[0].content).toBe(TEXT)
    await CommentService.getInstance().acceptReplyProposal(proposal)
    expect(p.messages.value[0].content).toBe('A bright lamp glows.')
    expect((p as any).getMessagesForModel()[0].content[0].text).toBe('A bright lamp glows.')
    // The original is versioned on the reply; old clients must read the current provider text.
    expect((await disk()).messages[0].revisions?.[0].before).toBe(TEXT)
    expect((await disk()).internalMessages[0].content).toEqual([
      { type: 'text', text: 'A bright lamp glows.' },
    ])
    await p.undoReplyRevision('reply')
    expect((p as any).getMessagesForModel()[0].content[0].text).toBe(TEXT)
    expect((await disk()).internalMessages[0].content).toEqual([{ type: 'text', text: TEXT }])
  })

  it('accepts with a closed parent and keeps the original after reopen', async () => {
    const { p, proposal } = await propose()
    await ChatService.getInstance().closeTab(p.id)
    await CommentService.getInstance().acceptReplyProposal(proposal)
    const reopened = await parent()
    expect(reopened.messages.value[0].revisions?.[0].before).toBe(TEXT)
    expect((reopened as any).getMessagesForModel()[0].content[0].text).toBe('A bright lamp glows.')
  })

  it('refuses stale proposals and a parent in mid-turn without changing anything', async () => {
    const { p, proposal } = await propose()
    p.isStreaming.value = true
    await expect(CommentService.getInstance().acceptReplyProposal(proposal)).rejects.toThrow(
      /working/
    )
    p.isStreaming.value = false
    await CommentService.getInstance().acceptReplyProposal(proposal)
    await expect(
      CommentService.getInstance().acceptReplyProposal({ ...proposal, id: 'another' })
    ).rejects.toThrow(/changed/)
    expect(p.messages.value[0].revisions).toHaveLength(1)
  })

  it('does not publish or retry an acceptance whose disk write failed', async () => {
    const { p, proposal } = await propose()
    vi.spyOn(app.vault, 'process').mockRejectedValueOnce(new Error('sample disk failure'))
    await expect(CommentService.getInstance().acceptReplyProposal(proposal)).rejects.toThrow(
      'sample disk failure'
    )
    expect(p.messages.value[0].content).toBe(TEXT)
    await p.save()
    expect((await disk()).messages[0].content).toBe(TEXT)
  })

  it('namespaces proposal ids by comment so independent tool calls cannot collide', async () => {
    const first = await propose()
    const second = await propose()
    expect(first.proposal.id).not.toBe(second.proposal.id)
  })

  it('refuses a proposal that does not cite the current owner message', async () => {
    const { child } = await propose()
    await expect(
      createReplyRevisionTool(child).execute('other', {
        text: 'lamp',
        request: 'Invented instruction',
      })
    ).rejects.toThrow(/request/)
  })

  it('keeps a proposal on its tool message, and rejection changes only that decision', async () => {
    const { child, proposal } = await propose()
    ;(child as any).handleAgentEvent({
      type: 'tool_start',
      toolCallId: proposal.id,
      toolName: REPLY_REVISION_TOOL,
      args: { text: proposal.text, request: proposal.request },
    })
    ;(child as any).handleAgentEvent({
      type: 'tool_end',
      toolCallId: proposal.id,
      result: {
        content: [{ type: 'text', text: 'Proposed' }],
        details: { replyProposal: proposal },
      },
      isError: false,
    })
    await child.save()
    const tool = child.messages.value.find((m) => m.replyProposal)!
    await child.decideReplyProposal(tool.id, false)
    const saved = parseChat(await app.vault.read(child.currentChatFile.value!))
    expect(saved.messages.find((m) => m.id === tool.id)?.replyProposal?.status).toBe('rejected')
    expect((await disk()).messages[0].content).toBe(TEXT)
    await expect(child.decideReplyProposal(tool.id, true)).rejects.toThrow(/pending/)
  })

  it('supplies corrections even when the original reply has been compacted out of provider history', async () => {
    const { p, proposal } = await propose()
    ;(p as any).allInternalMessages.push({
      role: 'system',
      content: '[Conversation compacted] Earlier answer: small lantern.',
      timestamp: 2,
    })
    await p.save()
    await CommentService.getInstance().acceptReplyProposal(proposal)
    const history = (p as any).getMessagesForModel()
    expect(JSON.stringify(history)).toContain('A bright lamp glows.')
    // Emulate the previous client's v2 reader: slice after its last compaction, no projection.
    const persisted = (await disk()).internalMessages
    const compact = persisted.findLastIndex(
      (m) => m.role === 'system' && m.content.startsWith('[Conversation compacted]')
    )
    expect(
      persisted
        .slice(compact + 1)
        .some(
          (m) =>
            m.role === 'assistant' && JSON.stringify(m.content).includes('A bright lamp glows.')
        )
    ).toBe(true)
    expect(
      persisted
        .slice(compact + 1)
        .some((m) => m.role === 'system' && m.content.includes('A bright lamp glows.'))
    ).toBe(false)
  })

  it('does not overwrite an externally changed internal record with an unchanged count', async () => {
    const p = await parent()
    const changed = await disk()
    ;(changed.internalMessages[0] as any).content[0].text = 'A separately corrected transcript.'
    await app.vault.modify(file(), serializeChat({ ...changed, metadata: changed.metadata! }))
    await expect(p.highlightReply('reply', 'small', 2, 'yellow')).rejects.toThrow(/changed/)
    expect((await disk()).internalMessages).toEqual(changed.internalMessages)
  })

  it('does not overwrite an externally changed open chat', async () => {
    const { p, proposal } = await propose()
    const changed = await disk()
    changed.messages[0].content = 'An externally revised reply.'
    await app.vault.modify(file(), serializeChat({ ...changed, metadata: changed.metadata! }))
    await expect(CommentService.getInstance().acceptReplyProposal(proposal)).rejects.toThrow(
      /changed/
    )
    expect((await disk()).messages[0].content).toBe('An externally revised reply.')
    expect(p.messages.value[0].content).toBe(TEXT)
  })
})
