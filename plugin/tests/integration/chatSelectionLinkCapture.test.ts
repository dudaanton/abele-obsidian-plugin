import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { captureSelectionLink } from '@/ai/openChat'
import { parseAnchorLink } from '@/selection/anchorLinks'
import * as renderer from '@/ai/replyMarkdown'

const PATH = 'Chats/sample-link.abchat'
let app: ReturnType<typeof useVault>
let session: ChatSession
beforeEach(async () => {
  app = useVault([
    {
      path: PATH,
      content: serializeChat({
        metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
        messages: [{ id: 'reply', role: 'assistant', content: 'echo **echo**', timestamp: 1 }],
        internalMessages: [],
      }),
    },
  ])
  ChatStorage.destroy()
  vi.spyOn(renderer, 'replyMarkdownText').mockResolvedValue('echo echo')
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], chatHistory: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(ChatService.getInstance())
  await session.load(app.vault.getAbstractFileByPath(PATH) as TFile)
})
afterEach(() => session.destroy())

describe('captured copy-link adapter', () => {
  it('durably saves the exact occurrence without changing Markdown and follows a rename', async () => {
    const prepare = captureSelectionLink(session, 'reply', 'echo', 5, 'echo echo')
    const file = session.currentChatFile.value!
    await app.vault.rename(file, 'Chats/renamed.abchat')
    const link = await prepare()
    const parsed = parseAnchorLink(link.slice(2, -2).split('|')[0])!
    const saved = parseChat(await app.vault.read(file))
    expect(parsed.pathHint).toBe('Chats/renamed.abchat')
    expect(parsed.address.chatId).toBe(saved.metadata?.chatId)
    expect(saved.messages[0].content).toBe('echo **echo**')
    expect(saved.messages[0].selection?.anchors[0].snapshot.source.range).toEqual({
      space: 'rendered',
      start: 5,
      end: 9,
    })
  })
  it('rejects a selection if the message changes before the menu action', async () => {
    const prepare = captureSelectionLink(session, 'reply', 'echo', 5, 'echo echo')
    ;(session as any).updateChatMessage(
      (message: any) => message.id === 'reply',
      (message: any) => ({ ...message, content: 'changed echo' })
    )
    await expect(prepare()).rejects.toThrow('captured selection changed')
  })
  it('rejects a stale DOM projection instead of assigning it to the current source', async () => {
    const prepare = captureSelectionLink(session, 'reply', 'echo', 6, 'wrong echo')
    await expect(prepare()).rejects.toThrow('rendered selection changed')
    expect(
      parseChat(await app.vault.read(session.currentChatFile.value!)).metadata?.chatId
    ).toBeUndefined()
  })

  it('serializes overlapping source reconciliations without mistaking its own adoption for an edit', async () => {
    const source = session.currentChatFile.value!
    const saved = parseChat(await app.vault.read(source))
    await app.vault.modify(
      source,
      serializeChat({
        metadata: { ...saved.metadata!, title: 'Updated sample title' },
        messages: saved.messages,
        internalMessages: saved.internalMessages,
      })
    )
    await Promise.all([
      session.reconcileForSelectionReturn(),
      session.reconcileForSelectionReturn(),
    ])
    expect(session.chatTitle.value).toBe('Updated sample title')
    expect(session.allMessages.value[0].content).toBe('echo **echo**')
  })

  it.each(['empty', 'pending', 'settled'] as const)(
    'does not retire a return when an attention scan keeps the same %s requests',
    async (mode) => {
      const call = {
        type: 'toolCall' as const,
        id: 'sample-request',
        name: 'read',
        arguments: { path: 'Notes/sample.md' },
      }
      if (mode === 'pending') {
        session.pendingToolCalls.value = [call]
        await session.save()
      }
      const source = session.currentChatFile.value!
      const saved = parseChat(await app.vault.read(source))
      if (mode === 'settled') {
        saved.metadata!.pendingToolCalls = [call]
        saved.metadata!.attention = { resolved: [call.id] }
      }
      const requests = session.pendingToolCalls.value
      const read = app.vault.read.bind(app.vault)
      let scanned = false
      vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
        if (file === source && !scanned) {
          scanned = true
          session.applyAttentionTruth(saved.metadata!)
        }
        return read(file)
      })
      await session.reconcileForSelectionReturn()
      expect(session.pendingToolCalls.value).toBe(requests)
      expect(session.allMessages.value[0].content).toBe('echo **echo**')
    }
  )

  it('still rejects an actual local edit during a source read', async () => {
    const source = session.currentChatFile.value!
    const read = app.vault.read.bind(app.vault)
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let held = false
    vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
      if (file === source && !held) {
        held = true
        entered()
        await blocked
      }
      return read(file)
    })
    const returning = session.reconcileForSelectionReturn()
    await started
    session.chatTitle.value = 'Unsaved sample title'
    release()
    await expect(returning).rejects.toThrow('This chat changed while returning')
    expect(session.chatTitle.value).toBe('Unsaved sample title')
  })

  it('abandons an obsolete queued return without changing the source', async () => {
    let current = true
    const first = session.reconcileForSelectionReturn()
    const queued = session.reconcileForSelectionReturn(() => current)
    current = false
    await Promise.all([first, queued])
    expect(session.allMessages.value[0].content).toBe('echo **echo**')
  })

  it('exposes no backlink when saving the anchor fails', async () => {
    const prepare = captureSelectionLink(session, 'reply', 'echo', 5, 'echo echo')
    vi.spyOn(session, 'ensureChatAnchor').mockRejectedValue(new Error('anchor write failed'))
    await expect(prepare()).rejects.toThrow('anchor write failed')
    const saved = parseChat(await app.vault.read(session.currentChatFile.value!))
    expect(saved.messages[0].selection?.anchors).toEqual([])
  })
})
