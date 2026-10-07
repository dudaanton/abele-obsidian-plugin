import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice, TFile, type App } from 'obsidian'
import { chatCopyPath } from '@/ai/chatCopy'
import { ChatService, MAX_TABS } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { RunStorage } from '@/ai/RunStorage'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const stream = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Cloning must not contact a model')
  })
)
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    stream = stream
  },
}))
destroyChatsAfterEach()
beforeEach(() => {
  useVault([])
  ChatService.getInstance().destroy()
  ChatStorage.destroy()
  RunStorage.destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  Notice.shown.length = 0
  stream.mockClear()
})
afterEach(() => ChatService.getInstance().destroy())

async function sourceChat() {
  const app = useVault([])
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample agent',
    providerId: 'sample-provider',
    modelId: 'sample-model',
  })
  AgentRegistry.getInstance().setDefault(agent.id)
  const service = ChatService.getInstance()
  const source = service.getSession(service.createTab())!
  await app.vault.createFolder('AI')
  await app.vault.createFolder('AI/Chats')
  const file = await app.vault.create(
    'AI/Chats/Sample.abchat',
    serializeChat({
      metadata: {
        type: 'abele-chat',
        title: 'Sample',
        created: '2025-01-01',
        providerId: 'sample-provider',
        modelId: 'sample-model',
        agentId: agent.id,
        overrides: { permissionMode: 'confirm-all' },
        activeLeafId: 'later',
        comments: [{ id: 'sample-comment', message: 'answer' }],
      },
      messages: [
        {
          id: 'root',
          role: 'user',
          content: 'First question',
          timestamp: 1,
          attachments: ['Attachments/sample.png'],
        },
        {
          id: 'sibling',
          parentId: 'root',
          role: 'assistant',
          content: 'Sibling reply',
          timestamp: 2,
        },
        {
          id: 'answer',
          parentId: 'root',
          role: 'assistant',
          content: 'Chosen reply',
          timestamp: 3,
        },
        { id: 'later', parentId: 'answer', role: 'user', content: 'Later question', timestamp: 4 },
      ],
      internalMessages: [
        { role: 'user', content: 'First question', timestamp: 1, chatMessageId: 'root' },
        { role: 'user', content: 'Later question', timestamp: 4, chatMessageId: 'later' },
      ],
    })
  )
  await source.load(file)
  return { app, service, source, file }
}

describe('clone into a new chat tab', () => {
  it('writes an independent file, opens another tab, preserves the original and sends nothing', async () => {
    const { app, service, source, file } = await sourceChat()
    const before = await app.vault.read(file)
    source.draft.value.text = 'Unsent source draft'
    await service.cloneChatFromMessage(source.id, 'answer')
    const clone = service.activeSession.value!
    expect(clone.id).not.toBe(source.id)
    expect(service.tabOrder.value).toEqual([source.id, clone.id])
    expect(clone.currentChatFile.value).toBeInstanceOf(TFile)
    expect(clone.currentChatFile.value!.path).not.toBe(file.path)
    expect(clone.messages.value.map((m) => m.content)).toEqual(['First question', 'Chosen reply'])
    expect(clone.permissionMode.value).toBe('confirm-all')
    expect(clone.agentId.value).toBe(source.agentId.value)
    expect(clone.draft.value.text).toBe('')
    expect(source.draft.value.text).toBe('Unsent source draft')
    expect(source.messages.value.at(-1)!.id).toBe('later')
    expect(clone.messageComments.value).toEqual([])
    const saved = parseChat(await app.vault.read(clone.currentChatFile.value!))
    expect(saved.metadata?.title).toBe('Sample (копия)')
    expect(saved.messages[0].id).not.toBe('root') // no shared rewind identity
    expect(await app.vault.read(file)).toBe(before)
    expect(stream).not.toHaveBeenCalled()
    expect(clone.isStreaming.value).toBe(false)
  })

  it('refuses at the tab limit, while busy, and for messages off the current path', async () => {
    const { app, service, source } = await sourceChat()
    const files = app.vault.getFiles().length
    await service.cloneChatFromMessage(source.id, 'sibling')
    source.isStreaming.value = true
    await service.cloneChatFromMessage(source.id, 'answer')
    source.isStreaming.value = false
    while (service.canCreateTab) service.createTab()
    await service.cloneChatFromMessage(source.id, 'answer')
    expect(service.tabOrder.value).toHaveLength(MAX_TABS)
    expect(app.vault.getFiles()).toHaveLength(files)
    expect(Notice.shown.join('\n')).toContain('busy')
    expect(Notice.shown.join('\n')).toContain('Close one')
    expect(stream).not.toHaveBeenCalled()
  })

  it('does not leave a hidden file when its new tab is closed during the write', async () => {
    const { app, service, source } = await sourceChat()
    const storage = ChatStorage.getInstance()
    const save = storage.saveChat.bind(storage)
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = vi.fn()
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      entered()
      await waiting
      return save(...args)
    })
    const pending = service.cloneChatFromMessage(source.id, 'answer')
    await vi.waitFor(() => expect(entered).toHaveBeenCalled())
    await service.closeTab(service.activeTabId.value!)
    release()
    await pending
    expect(app.vault.getFiles().map((file) => file.path)).toEqual([
      source.currentChatFile.value!.path,
    ])
    expect(service.activeSession.value).toBe(source)
    expect(Notice.shown.join('\n')).toContain('closed')
  })

  it('copies delegated transcripts so deleting the clone cannot remove the source run', async () => {
    const { app, service, source, file } = await sourceChat()
    const runs = RunStorage.getInstance()
    await runs.save({
      type: 'abele-run',
      runId: 'sample-run',
      agentId: 'sample-agent',
      agentName: 'Sample worker',
      parentChat: file.path,
      parentToolCallId: 'sample-call',
      task: 'Sample task',
      created: '2025-01-01',
      status: 'done',
      depth: 1,
      branches: [
        {
          item: 'Sample item',
          status: 'done',
          result: 'Done',
          messages: [
            { id: 'run-message', role: 'assistant', content: 'Worker reply', timestamp: 2 },
          ],
        },
      ],
    })
    const data = parseChat(await app.vault.read(file))
    data.messages[1].subAgentRun = {
      runId: 'sample-run',
      agentId: 'sample-agent',
      agentName: 'Sample worker',
      path: runs.runPath('sample-run'),
      status: 'done',
      branchCount: 1,
    }
    data.messages[2].subAgentRun = data.messages[1].subAgentRun
    await app.vault.modify(
      file,
      serializeChat({
        metadata: data.metadata!,
        messages: data.messages,
        internalMessages: data.internalMessages,
      })
    )
    await source.load(file)
    const backup = chatCopyPath(app as unknown as App, runs.runPath('sample-run'))
    await app.vault.adapter.write(backup, 'A source writer safety copy')
    await service.cloneChatFromMessage(source.id, 'answer')
    expect(await app.vault.adapter.read(backup)).toBe('A source writer safety copy')
    const clone = service.activeSession.value!
    const ref = clone.messages.value[1].subAgentRun!
    expect(ref.runId).not.toBe('sample-run')
    expect(await runs.load(ref.runId)).toMatchObject({
      parentChat: clone.currentChatFile.value!.path,
      branches: [{ messages: [{ content: 'Worker reply' }] }],
    })
    await service.deleteChat(clone.id)
    expect(await runs.load(ref.runId)).toBeNull()
    expect(await runs.load('sample-run')).not.toBeNull()
  })
})
