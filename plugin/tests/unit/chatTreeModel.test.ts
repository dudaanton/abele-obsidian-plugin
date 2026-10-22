import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { chatsOf } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { TFile } from 'obsidian'
import { NodeService } from '@/node/NodeService'
import * as dialogs from '@/components/obsidian/dialogs'
import { RunStorage } from '@/ai/RunStorage'

it('records explicitly reopening the selected chat as a new reveal request', () => {
  useVault([])
  const id = service.createTab()
  const tree = service.tree
  const before = tree.selectionVersion.value
  service.switchTab(id)
  expect(tree.selectionVersion.value).toBeGreaterThan(before)
})

it('does not request a reveal for restored or fallback selections', () => {
  const first = service.createTab()
  const second = service.createTab()
  const tree = service.tree
  service.activeTabId.value = first
  expect(tree.selectionVersion.value).toBe(0)
  service.switchTab(second)
  const selected = tree.selectionVersion.value
  service.activeTabId.value = first
  expect(tree.selectionVersion.value).toBe(selected)
})

it('does not replay a helper reveal when a fallback tab becomes active', async () => {
  const parent = service.createTab()
  const tree = service.tree
  const load = vi.spyOn(RunStorage.getInstance(), 'load').mockResolvedValue({
    type: 'abele-run',
    runId: 'sample-fold-run',
    agentId: 'sample-agent',
    agentName: 'Sample helper',
    parentChat: parent,
    parentToolCallId: 'sample-call',
    task: 'Sample task',
    created: '2099-01-01T00:00:00Z',
    status: 'done',
    depth: 1,
    branches: [],
  })
  try {
    await service.openRun('sample-fold-run')
    service.switchTab('run:sample-fold-run')
    const selected = tree.selectionVersion.value
    service.activeTabId.value = parent
    expect(tree.selectionVersion.value).toBe(selected)
  } finally {
    load.mockRestore()
  }
})

it('shows times for loaded, unloaded and closed chats without loading their sessions', () => {
  const app = useVault(
    ['AI/Chats/loaded.abchat', 'AI/Chats/unloaded.abchat', 'AI/Chats/closed.abchat'].map(
      (path) => ({ path, content: '' })
    )
  )
  const paths = app.vault.getFiles().map((file) => file.path)
  const ids = paths.slice(0, 2).map((path) => {
    const id = service.createTab()
    service.getSession(id)!.currentChatFile.value = app.vault.getAbstractFileByPath(path) as TFile
    return id
  })
  const loaded = service.getSession(ids[0])! as unknown as {
    appendChatMessage(message: ChatMessage): void
    updateVisibleMessages(): void
  }
  loaded.appendChatMessage({
    id: 'sample-latest',
    role: 'user',
    content: 'Sample',
    timestamp: 9000,
  })
  loaded.updateVisibleMessages()
  AbeleConfig.getInstance().ai.chatHistory = paths.map((path, i) => ({
    path,
    title: path,
    created: '',
    lastMessageAt: 1000 + i,
  }))
  const tree = service.tree
  const rows = chatsOf(tree.root.value)
  expect(ids.map((id) => rows.find((row) => row.id === id)?.at)).toEqual([9000, 1001])
  expect(rows.find((row) => row.id === paths[2])?.at).toBe(1002)
})

it('uses file modification time when the index has no last-message time', () => {
  const app = useVault([{ path: 'AI/Chats/sample.abchat', content: '' }])
  const file = app.vault.getFiles()[0]
  AbeleConfig.getInstance().ai.chatHistory = [{ path: file.path, title: 'Sample', created: '' }]
  const read = vi.spyOn(app.vault, 'cachedRead')
  expect(chatsOf(service.tree.root.value)[0].at).toBe(file.stat.mtime)
  expect(read).not.toHaveBeenCalled()
})

it('reads conversation time from a legacy index entry instead of a move timestamp', async () => {
  const path = 'AI/Chats/sample.abchat'
  useVault([
    {
      path,
      content: serializeChat({
        metadata: {
          type: 'abele-chat',
          title: 'Sample',
          created: '2025-01-01',
          providerId: '',
          modelId: '',
        },
        messages: [
          { id: 'sample-message', role: 'user', content: 'Sample question', timestamp: 1234 },
        ],
        internalMessages: [],
      }),
    },
  ])
  AbeleConfig.getInstance().ai.chatHistory = [{ path, title: 'Sample', created: '' }]
  await service.tree.refresh()
  expect(chatsOf(service.tree.root.value).find((entry) => entry.id === path)?.at).toBe(1234)
})

let service: ChatService
beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    agents: [],
    chatHistory: [],
  }
  service = ChatService.getInstance()
})
afterEach(() => service.destroy())

it('keeps an untitled saved conversation title stable as the clock advances', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2025-01-01T10:00:00Z'))
    const id = service.createTab()
    const session = service.getSession(id)! as unknown as {
      snapshot(): { metadata: { title: string } }
    }
    const title = session.snapshot().metadata.title
    vi.setSystemTime(new Date('2025-01-01T11:00:00Z'))
    expect(session.snapshot().metadata.title).toBe(title)
  } finally {
    vi.useRealTimers()
  }
})

it('moves a closed node reference into a folder and persists its placement', async () => {
  await service.folders.create('', 'Projects')
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title: 'Sample node',
  }
  const id = 'node:sample-registration:sample-session'
  service.closedNodeChats.value = [{ reference, at: 100 }]
  service.tree.move(id, 'Projects')
  await vi.waitFor(() => {
    const folder = service.tree.root.value.find(
      (entry) => entry.kind === 'folder' && entry.path === 'Projects'
    )
    expect(folder?.children?.some((entry) => entry.kind === 'chat' && entry.id === id)).toBe(true)
  })
  // Node placement lives in the synced folder catalog, not in device-local tab state.
  const catalog = async () => {
    const app = GlobalStore.getInstance().app
    const file = app.vault.getAbstractFileByPath(`${service.folders.path('')}/_folders.abelechats`)
    return JSON.parse(await app.vault.read(file as TFile)) as {
      folders: { id: string; name: string }[]
      nodes: Record<string, string | null>
    }
  }
  const stored = await catalog()
  expect(stored.nodes[id]).toBe(stored.folders.find((folder) => folder.name === 'Projects')?.id)
  expect(
    GlobalStore.getInstance().app.loadLocalStorage('abele-agent-tabs') ?? {}
  ).not.toHaveProperty('nodeFolders')
  await service.folders.rename('Projects', 'Renamed')
  expect(service.folders.folderOf(id)).toBe('Renamed')
  // Deleting a folder never deletes chats: the node chat returns to the parent (root here).
  await service.folders.remove('Renamed')
  expect(service.folders.paths).not.toContain('Renamed')
  expect(service.folders.folderOf(id)).toBe('')
  expect(service.closedNodeChats.value.map((entry) => entry.reference)).toEqual([reference])
})

it('renames and deletes a closed node session through its own node while retaining folder files', async () => {
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title: 'Sample node',
  }
  const id = 'node:sample-registration:sample-session'
  const client = { renameSession: vi.fn(async () => ({})), deleteSession: vi.fn(async () => ({})) }
  const nodes = vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: reference.registrationId, expectedNodeId: reference.nodeId }]),
    connection: () => ({ client }),
  } as never)
  const prompt = vi.spyOn(dialogs, 'promptDialog').mockResolvedValue('Renamed sample')
  try {
    service.closedNodeChats.value = [{ reference, at: 100 }]
    service.tree.rename(id)
    await vi.waitFor(() =>
      expect(service.closedNodeChats.value[0].reference.title).toBe('Renamed sample')
    )
    expect(client.renameSession).toHaveBeenCalledWith(reference.sessionId, 'Renamed sample')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ submitText: 'Rename' }))
    await service.folders.create('', 'Projects')
    await service.folders.move(id, 'Projects')
    expect(service.folders.folderOf(id)).toBe('Projects')
    service.tree.delete(id)
    await vi.waitFor(() => expect(service.closedNodeChats.value).toEqual([]))
    expect(client.deleteSession).toHaveBeenCalledWith(reference.sessionId)
    await vi.waitFor(() => expect(service.folders.membershipOf(id)).toBeUndefined())
  } finally {
    prompt.mockRestore()
    nodes.mockRestore()
  }
})

it('retains helper runs beneath a closed parent and reopens them through the run service', async () => {
  await service.folders.create('', 'Projects')
  const id = service.createTab()
  const parent = service.getSession(id)!
  await service.folders.move(id, 'Projects')
  await parent.createInDirectory(service.folders.path(''))
  const fixture = parent as unknown as {
    appendChatMessage(message: ChatMessage): void
    updateVisibleMessages(): void
  }
  fixture.appendChatMessage({
    id: 'sample-helper-call',
    role: 'tool-call',
    content: '',
    timestamp: 100,
    toolName: 'delegate',
    subAgentRun: {
      runId: 'sample-run',
      agentId: 'sample-agent',
      agentName: 'Sample helper',
      path: 'AI/Runs/sample.abchat',
      status: 'done',
      branchCount: 1,
    },
  })
  fixture.updateVisibleMessages()
  parent.markDirty()
  const tree = service.tree
  await tree.refresh()
  expect(chatsOf(tree.root.value).find((chat) => chat.id === id)?.children).toContainEqual(
    expect.objectContaining({ id: 'run:sample-run', open: true })
  )
  const file = parent.currentChatFile.value!
  await service.closeTab(id)
  const disk = parseChat(await GlobalStore.getInstance().app.vault.read(file))
  expect(disk.messages.some((message) => message.subAgentRun?.runId === 'sample-run')).toBe(true)
  await tree.refresh()
  expect(
    chatsOf(tree.root.value).find((chat) => chat.id === 'run:sample-run'),
    JSON.stringify(tree.root.value)
  ).toMatchObject({
    open: false,
    nested: 'helper',
  })
  const open = vi.spyOn(service, 'openRun').mockResolvedValue(true)
  tree.open('run:sample-run')
  expect(open).toHaveBeenCalledWith('sample-run')
})

it('retains a closed node reference under its parent in device-local layout', async () => {
  const id = service.createTab()
  const parent = service.getSession(id)!
  await service.folders.create('', 'Projects')
  await service.folders.move(id, 'Projects')
  await parent.createInDirectory(service.folders.path(''))
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title: 'Sample node work',
  }
  const nodeId = 'node:sample-registration:sample-session'
  const node = {
    id: nodeId,
    reference,
    label: ref(reference.title),
    messages: ref([]),
    isStreaming: ref(false),
    provider: ref('fake'),
    projection: ref({ prompts: [] }),
    error: ref(''),
    destroy: vi.fn(),
  } as unknown as NodeChatPresenter
  ;(service as unknown as { nodeSessions: Map<string, NodeChatPresenter> }).nodeSessions.set(
    nodeId,
    node
  )
  service.nodeParentPaths.value = { [nodeId]: parent.currentChatFile.value!.path }
  service.tabOrder.value = [...service.tabOrder.value, nodeId]
  await service.closeTab(nodeId)
  const tree = service.tree
  await tree.refresh()
  expect(chatsOf(tree.root.value).find((chat) => chat.id === id)?.children).toContainEqual(
    expect.objectContaining({ id: nodeId, open: false, nested: 'node' })
  )
  expect(service.closedNodeChats.value[0].reference).toEqual(reference)
  expect(node.destroy).toHaveBeenCalledOnce()
})

it('files open and closed node chats by stable reference without creating transcripts', async () => {
  await service.folders.create('', 'Projects')
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title: 'Sample node work',
  }
  const nodeId = 'node:sample-registration:sample-session'
  const node = {
    id: nodeId,
    reference,
    label: ref(reference.title),
    messages: ref([]),
    isStreaming: ref(false),
    provider: ref('fake'),
    projection: ref({ prompts: [] }),
    error: ref(''),
    destroy: vi.fn(),
  } as unknown as NodeChatPresenter
  ;(service as unknown as { nodeSessions: Map<string, NodeChatPresenter> }).nodeSessions.set(
    nodeId,
    node
  )
  service.tabOrder.value = [...service.tabOrder.value, nodeId]
  await service.folders.move(nodeId, 'Projects')
  expect(service.listOpenChats().find((chat) => chat.id === nodeId)?.folder).toBe('Projects')
  await service.closeTab(nodeId)
  await service.folders.reload()
  await service.tree.refresh()
  const folder = service.tree.root.value.find(
    (entry) => entry.kind === 'folder' && entry.path === 'Projects'
  )!
  expect(chatsOf([folder])).toContainEqual(expect.objectContaining({ id: nodeId, open: false }))
  expect(
    GlobalStore.getInstance()
      .app.vault.getFiles()
      .filter((file) => file.extension === 'abchat')
  ).toEqual([])
  await service.folders.move(nodeId, '')
  await service.folders.reload()
  expect(service.folders.folderOf(nodeId)).toBe('')
})

it('renames a chat title from the tree without renaming its transcript', async () => {
  const dialogs = await import('@/components/obsidian/dialogs')
  const prompt = vi.spyOn(dialogs, 'promptDialog').mockResolvedValue('Renamed sample')
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.createInDirectory(service.folders.path(''))
  const path = session.currentChatFile.value!.path
  const rename = vi.spyOn(GlobalStore.getInstance().app.fileManager, 'renameFile')
  try {
    service.tree.rename(id)
    await vi.waitFor(() => expect(session.chatTitle.value).toBe('Renamed sample'))
    await vi.waitFor(async () =>
      expect(
        parseChat(await GlobalStore.getInstance().app.vault.read(session.currentChatFile.value!))
          .metadata?.title
      ).toBe('Renamed sample')
    )
    await session.saveForRelease()
    expect(session.currentChatFile.value!.path).toBe(path)
    expect(rename).not.toHaveBeenCalled()
  } finally {
    prompt.mockRestore()
    rename.mockRestore()
  }
})
