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

describe('reply annotation persistence and owner decisions', () => {
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
    expect((await disk()).internalMessages[0].content).toEqual([{ type: 'text', text: TEXT }])
    await p.undoReplyRevision('reply')
    expect((p as any).getMessagesForModel()[0].content[0].text).toBe(TEXT)
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
