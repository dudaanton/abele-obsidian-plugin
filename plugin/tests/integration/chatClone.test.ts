import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice, TFile, type App } from 'obsidian'
import { mount, flushPromises } from '@vue/test-utils'
import AiRunView from '@/components/AiRunView.vue'
import { chatCopyPath } from '@/ai/chatCopy'
import { ChatService, MAX_TABS } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { RunStorage, type RunFile } from '@/ai/RunStorage'
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

async function nestedSource() {
  const fixture = await sourceChat()
  const { app, source, file } = fixture
  const runs = RunStorage.getInstance()
  const parent: RunFile = {
    type: 'abele-run',
    runId: 'sample-parent-run',
    agentId: 'sample-agent',
    agentName: 'Sample worker',
    parentChat: file.path,
    parentToolCallId: 'parent-call',
    task: 'Sample parent task',
    created: '2025-01-01',
    status: 'done',
    depth: 1,
    branches: [
      {
        item: 'Sample item',
        status: 'done',
        messages: [
          {
            id: 'parent-message',
            role: 'assistant',
            content: 'Parent reply',
            timestamp: 2,
            subAgentRun: {
              runId: 'sample-child-run',
              agentId: 'sample-agent',
              agentName: 'Sample helper',
              path: runs.runPath('sample-child-run'),
              status: 'done',
              branchCount: 1,
            },
          },
        ],
      },
    ],
  }
  await runs.save({
    ...parent,
    runId: 'sample-child-run',
    depth: 2,
    parentChat: runs.runPath(parent.runId),
    branches: [
      {
        item: 'Sample child',
        status: 'done',
        messages: [
          { id: 'child-message', role: 'assistant', content: 'Child reply', timestamp: 3 },
        ],
      },
    ],
  })
  await runs.save(parent)
  const data = parseChat(await app.vault.read(file))
  data.messages[2].subAgentRun = {
    runId: parent.runId,
    agentId: parent.agentId,
    agentName: parent.agentName,
    path: runs.runPath(parent.runId),
    status: 'done',
    branchCount: 1,
  }
  await app.vault.modify(
    file,
    serializeChat({
      metadata: data.metadata!,
      messages: data.messages,
      internalMessages: data.internalMessages,
    })
  )
  await source.load(file)
  return { ...fixture, runs }
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

  it('holds a pending clone read-only and adopts it without resetting a delivered draft', async () => {
    const { app, service, source } = await sourceChat()
    const storage = ChatStorage.getInstance()
    const save = storage.saveChat.bind(storage)
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      await waiting
      return save(...args)
    })
    const pending = service.cloneChatFromMessage(source.id, 'answer')
    const clone = service.activeSession.value!
    try {
      expect(clone.preparingClone.value).toBe(true)
      expect(clone.isMidTurn).toBe(true)
      const attachment = await app.vault.create('sample-attachment.txt', 'Sample attachment')
      clone.draft.value.text = 'Delivered draft'
      clone.draft.value.attachments = [attachment]
      const draft = clone.draft.value
      await clone.sendMessage('Must not start a turn')
      expect(stream).not.toHaveBeenCalled()
      expect(clone.queuedMessages.value).toEqual([])
      release()
      await pending
      expect(clone.draft.value).toBe(draft)
      expect(clone.draft.value.text).toBe('Delivered draft')
      expect(clone.draft.value.attachments).toEqual([attachment])
      expect(clone.messages.value.map((message) => message.content)).toEqual([
        'First question',
        'Chosen reply',
      ])
      expect(clone.preparingClone.value).toBe(false)
      expect(clone.isMidTurn).toBe(false)
    } finally {
      release()
      await pending
    }
  })

  it('cancels a clone cleanly when its reserved tab opens another conversation', async () => {
    const { app, service, source } = await nestedSource()
    const storage = ChatStorage.getInstance()
    const save = storage.saveChat.bind(storage)
    const entered = vi.fn()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(storage, 'saveChat').mockImplementation(async (...args) => {
      entered()
      await waiting
      return save(...args)
    })
    const before = app.vault
      .getFiles()
      .map((file) => file.path)
      .sort()
    const pending = service.cloneChatFromMessage(source.id, 'answer')
    await vi.waitFor(() => expect(entered).toHaveBeenCalled())
    const holder = service.activeSession.value!
    const replacement = await app.vault.create(
      'AI/Chats/Replacement.abchat',
      serializeChat({
        metadata: {
          type: 'abele-chat',
          title: 'Replacement',
          agentId: source.agentId.value,
          providerId: 'sample-provider',
          modelId: 'sample-model',
          created: '2025-01-01',
        },
        messages: [
          { id: 'replacement-root', role: 'user', content: 'Replacement question', timestamp: 1 },
        ],
        internalMessages: [],
      })
    )
    await service.openChatInTab(holder.id, replacement)
    holder.draft.value.text = 'Replacement draft'
    release()
    await pending
    expect(service.activeSession.value).toBe(holder)
    expect(holder.currentChatFile.value).toBe(replacement)
    expect(holder.messages.value[0].content).toBe('Replacement question')
    expect(holder.draft.value.text).toBe('Replacement draft')
    expect(holder.preparingClone.value).toBe(false)
    expect(
      app.vault
        .getFiles()
        .map((file) => file.path)
        .sort()
    ).toEqual([...before, replacement.path].sort())
  })

  it('deletes both levels of copied delegated work without deleting either original transcript', async () => {
    const { app, service, source, runs } = await nestedSource()
    const parentOriginal = app.vault.getFileByPath(runs.runPath('sample-parent-run'))!
    const childOriginal = app.vault.getFileByPath(runs.runPath('sample-child-run'))!
    const parentBefore = await app.vault.read(parentOriginal)
    const childBefore = await app.vault.read(childOriginal)
    await service.cloneChatFromMessage(source.id, 'answer')
    const clone = service.activeSession.value!
    const parent = (await runs.load(clone.messages.value[1].subAgentRun!.runId))!
    const childRef = parent.branches[0].messages[0].subAgentRun!
    expect(childRef.runId).not.toBe('sample-child-run')
    expect(await runs.load(childRef.runId)).not.toBeNull()
    await service.deleteChat(clone.id)
    expect(await runs.load(parent.runId)).toBeNull()
    expect(await runs.load(childRef.runId)).toBeNull()
    expect(await app.vault.read(parentOriginal)).toBe(parentBefore)
    expect(await app.vault.read(childOriginal)).toBe(childBefore)
  })

  it('returns from a nested copied run to its parent run without creating a writable chat', async () => {
    const { app, service, source, runs } = await nestedSource()
    await service.cloneChatFromMessage(source.id, 'answer')
    const clone = service.activeSession.value!
    const parent = (await runs.load(clone.messages.value[1].subAgentRun!.runId))!
    const child = (await runs.load(parent.branches[0].messages[0].subAgentRun!.runId))!
    const parentFile = app.vault.getFileByPath(runs.runPath(parent.runId))!
    const before = await app.vault.read(parentFile)
    await service.openRun(child.runId)
    const view = mount(AiRunView, {
      props: { run: child },
      global: { stubs: { AiRunBranch: true } },
    })
    try {
      await view.get('.abele-run-view__parent').trigger('click')
      await flushPromises()
      expect(service.activeRun?.runId).toBe(parent.runId)
      expect(service.activeSession.value).toBeNull()
      await service.closeTab(service.activeTabId.value!)
      expect(await app.vault.read(parentFile)).toBe(before)
    } finally {
      view.unmount()
    }
  })

  it.each(['append', 'rewrite'] as const)(
    'refuses a %s chat save over a run transcript',
    async (kind) => {
      const { app, source, runs } = await nestedSource()
      const runFile = app.vault.getFileByPath(runs.runPath('sample-parent-run'))!
      const before = await app.vault.read(runFile)
      const snapshot = source.cloneSnapshot('answer')!
      const content = serializeChat(snapshot)
      await expect(
        ChatStorage.getInstance().saveChat(
          snapshot,
          kind === 'append' ? { kind, data: content, records: 1 } : { kind, content, records: 1 },
          runFile
        )
      ).rejects.toThrow('run')
      expect(await app.vault.read(runFile)).toBe(before)
      await expect(ChatStorage.getInstance().loadChat(runFile)).rejects.toThrow('run')
    }
  )

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
    await app.vault.adapter.mkdir(backup.slice(0, backup.lastIndexOf('/')))
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
