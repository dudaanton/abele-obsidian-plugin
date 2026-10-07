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

  it('exposes no backlink when saving the anchor fails', async () => {
    const prepare = captureSelectionLink(session, 'reply', 'echo', 5, 'echo echo')
    vi.spyOn(session, 'ensureChatAnchor').mockRejectedValue(new Error('anchor write failed'))
    await expect(prepare()).rejects.toThrow('anchor write failed')
    const saved = parseChat(await app.vault.read(session.currentChatFile.value!))
    expect(saved.messages[0].selection?.anchors).toEqual([])
  })
})
