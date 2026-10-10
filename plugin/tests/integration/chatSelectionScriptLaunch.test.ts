import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { scriptSource } from '../helpers/scriptSource'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { captureChatScriptTarget } from '@/scripting/runFromChat'
import * as renderer from '@/ai/replyMarkdown'

const PATH = 'Chats/sample-launch.abchat'
let app: ReturnType<typeof useVault>
let session: ChatSession
let service: ScriptService
const saved = async () => parseChat(await app.vault.read(session.currentChatFile.value!))
const target = () => captureChatScriptTarget(session, 'reply', 'echo', 5, 'echo echo')!
const register = (params: unknown[] = []) => {
  const path = 'Scripts/sample.js'
  const code = 'return selection.text + " | " + selection.backlink + " | " + String(chat)'
  scriptSource(path, '// @name Sample\n' + code)
  ;(service as any).scripts.set(path, {
    path,
    code,
    commandId: '',
    meta: { name: 'Sample', description: '', params },
  })
  return path
}
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
  ScriptService.destroy()
  ScriptRuns.destroy()
  vi.spyOn(renderer, 'replyMarkdownText').mockResolvedValue('echo echo')
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], chatHistory: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
  session = new ChatSession(ChatService.getInstance())
  await session.load(app.vault.getAbstractFileByPath(PATH) as TFile)
  service = ScriptService.getInstance()
})
afterEach(() => {
  session.destroy()
  vi.restoreAllMocks()
})

describe('chat selection launch adapter', () => {
  it('captures without writing and saves the exact occurrence only when admitted', async () => {
    const captured = target()
    expect((await saved()).metadata?.chatId).toBeUndefined()
    expect((await saved()).messages[0].selection).toBeUndefined()
    expect(await service.executeFromSelection(register(), captured)).toMatchObject({
      status: 'done',
      output: expect.stringContaining('echo | [['),
    })
    const message = (await saved()).messages[0]
    expect(message.content).toBe('echo **echo**')
    expect(message.selection?.anchors[0].snapshot.source.range.start).toBe(5)
    expect(ScriptRuns.getInstance().runs.value[0]).toMatchObject({
      source: 'chat-selection',
      selection: { source: { messageId: 'reply' } },
    })
  })

  it('does not persist identities or anchors on form cancellation or rejected admission', async () => {
    const captured = target()
    const form = vi.spyOn(service, 'showParamForm').mockResolvedValue(null)
    await expect(
      service.executeFromSelection(
        register([{ name: 'extra', type: 'string', required: true }]),
        captured
      )
    ).resolves.toEqual({ status: 'cancelled' })
    expect(form).toHaveBeenCalledOnce()
    expect((await saved()).messages[0].selection).toBeUndefined()
    vi.spyOn(service, 'admit').mockRejectedValue(new Error('Not admitted'))
    await expect(service.executeFromSelection(register(), captured)).rejects.toThrow('Not admitted')
    expect((await saved()).metadata?.chatId).toBeUndefined()
  })

  it('keeps its owning conversation when a form outlives a tab switch', async () => {
    const captured = target()
    const path = register([{ name: 'extra', type: 'string', required: true }])
    let answer!: (value: Record<string, string>) => void
    vi.spyOn(service, 'showParamForm').mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const running = service.executeFromSelection(path, captured)
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    const other = new ChatSession(ChatService.getInstance())
    ChatService.getInstance().adoptSession(other)
    answer({ extra: 'ok' })
    expect(await running).toMatchObject({ status: 'done' })
    expect((await saved()).messages[0].selection?.anchors).toHaveLength(1)
    expect(ChatService.getInstance().activeSession.value).not.toBe(session)
    other.destroy()
  })

  it('reports stale versions after a form instead of retargeting by matching words', async () => {
    const captured = target()
    const path = register([{ name: 'extra', type: 'string', required: true }])
    vi.spyOn(service, 'showParamForm').mockImplementation(async () => {
      ;(session as any).updateChatMessage(
        (m: any) => m.id === 'reply',
        (m: any) => ({ ...m, content: 'echo changed echo' })
      )
      return { extra: 'ok' }
    })
    expect(await service.executeFromSelection(path, captured)).toMatchObject({
      status: 'conflict',
      reason: expect.stringContaining('changed'),
    })
    expect((await saved()).metadata?.chatId).toBeUndefined()
    expect(ScriptRuns.getInstance().runs.value).toHaveLength(0)
  })

  it('keeps captured display metadata through rename/title changes while the durable backlink follows the file', async () => {
    const originalTitle = session.chatTitle.value || session.currentChatFile.value!.basename
    const captured = target()
    session.chatTitle.value = 'Another display title'
    await app.vault.rename(session.currentChatFile.value!, 'Chats/moved-launch.abchat')
    await service.executeFromSelection(register(), captured)
    expect(ScriptRuns.getInstance().runs.value[0].selection).toMatchObject({
      title: originalTitle,
      pathHint: PATH,
      backlink: expect.stringContaining('Chats/moved-launch.abchat'),
    })
  })

  it('rejects drafts and streaming/non-message targets at capture', () => {
    expect(captureChatScriptTarget(session, 'streaming', 'echo', 0, 'echo')).toBeUndefined()
    ;(session as any).updateChatMessage(
      (m: any) => m.id === 'reply',
      (m: any) => ({ ...m, draft: true })
    )
    expect(target()).toBeUndefined()
  })

  it('executes nothing and exposes no backlink on persistence failure', async () => {
    vi.spyOn(session, 'ensureChatAnchor').mockRejectedValue(new Error('write failed'))
    await expect(service.executeFromSelection(register(), target())).rejects.toThrow('write failed')
    expect(ScriptRuns.getInstance().runs.value).toHaveLength(0)
    expect((await saved()).messages[0].content).toBe('echo **echo**')
  })
})
