import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { ChatFolders } from '@/chats/ChatFolders'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { CommentService } from '@/ai/CommentService'
import { ChatStorage } from '@/ai/ChatStorage'
import { chatsOf } from '@/chats/chatTree'
import { NodeScopeLedger } from '@/ai/nodeScope'
import type { AgentTool } from '@/ai/client'
import { NodeService } from '@/node/NodeService'
import { approveObsidianChatNodeAccess, nodeAgentHost } from '@/ai/tools/node/owner'

let service: ChatService
let folders: ChatFolders
let app: FakeApp
it('persists hidden state and reloads remote visibility changes', async () => {
  await folders.create('', 'Collection')
  await folders.create('Collection', 'Nested')
  await folders.setHidden('Collection', true)
  expect(folders.isHidden('Collection/Nested')).toBe(true)
  const file = app.vault.getAbstractFileByPath('AI/Chats/_folders.abelechats') as TFile
  const catalog = JSON.parse(await app.vault.read(file))
  expect(catalog.folders[0].hidden).toBe(true)
  catalog.folders[0].hidden = false
  await app.vault.modify(file, JSON.stringify(catalog))
  await folders.reload()
  expect(folders.isHidden('Collection')).toBe(false)
})

it('unhides ancestors when reopening a saved chat outside the tree', async () => {
  await folders.create('', 'Collection')
  await folders.create('Collection', 'Nested')
  await folders.move('AI/Chats/sample.abchat', 'Collection/Nested')
  await folders.setHidden('Collection', true)
  await folders.setHidden('Collection/Nested', true)
  await service.openChatFile(app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile)
  expect(folders.isHidden('Collection/Nested')).toBe(false)
  expect(folders.folderOf('AI/Chats/sample.abchat')).toBe('Collection/Nested')
})
it('reuses persisted placement for thousands of unchanged chats and refreshes a remote edit', async () => {
  await folders.reload()
  folders.destroy()
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      title: 'Synthetic',
      created: '',
      providerId: '',
      modelId: '',
      treeFolderId: 'first',
    },
    messages: [],
    internalMessages: [],
  })
  const files = await Promise.all(
    Array.from({ length: 2000 }, (_, i) =>
      app.vault.create(`AI/Chats/synthetic-${i}.abchat`, content)
    )
  )
  await ChatStorage.getInstance().refreshHistory()
  const read = vi.spyOn(app.vault, 'read')
  folders = new ChatFolders(app as never, service)
  await folders.reload()
  expect(read.mock.calls.filter(([file]) => file.extension === 'abchat')).toHaveLength(0)
  expect(folders.membershipOf(files[0].path)).toBe('first')
  await app.vault.modify(files[0], content.replace('first', 'second'))
  files[0].stat.mtime += 1000
  app.emit('vault', 'modify', files[0])
  await folders.reload()
  expect(folders.membershipOf(files[0].path)).toBe('second')
  expect(read.mock.calls.filter(([file]) => file.extension === 'abchat')).toHaveLength(1)
})
it('confirms an inherited scope in a draft without making it an own scope', async () => {
  const registrations = [
    {
      id: 'sample-registration',
      expectedNodeId: 'sample-node',
      label: 'Sample',
      url: 'http://127.0.0.1:1',
    },
  ]
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    registry: { list: () => registrations, authorizationId: () => 'sample-authority' },
    nodes: { value: registrations },
    connection: () => ({ client: { connected: true }, authorizationGeneration: 0 }),
  } as unknown as NodeService)
  await folders.create('', 'Collection')
  const entries = [{ kind: 'node' as const, node_id: 'sample-node', access: 'read' as const }]
  await folders.setNodeScope('Collection', entries)
  const session = service.getSession(service.createTab())!
  await folders.move(session.id, 'Collection')
  await approveObsidianChatNodeAccess(session, entries)
  expect(session.overrides.value.nodeScope).toBeUndefined()
  const host = await nodeAgentHost()
  expect(
    host.ledger.approvedNode(session, 'sample-node', host.connection('sample-node').principal())
  ).toBe(true)
  await folders.move(session.id, '')
  expect(
    host.ledger.approvedNode(session, 'sample-node', host.connection('sample-node').principal())
  ).toBe(false)
  const owner = folders.nodeScopeOwner('Collection')
  await approveObsidianChatNodeAccess(owner, entries)
  expect(folders.nodeScopeForFolder('Collection')).toEqual(entries)
  expect(
    host.ledger.approvedNode(owner, 'sample-node', host.connection('sample-node').principal())
  ).toBe(true)
})
it('allocates a durable chat identity before an inherited node edit executes', async () => {
  await folders.create('', 'Collection')
  await folders.setNodeScope('Collection', [
    { kind: 'node', node_id: 'sample-node', access: 'edit' },
  ])
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.load(app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile)
  await folders.move(id, 'Collection')
  expect(session.nodeScopeIdentity).toBeUndefined()
  const tool: AgentTool = {
    name: 'node_write',
    label: 'Write',
    description: 'Write a sample file',
    parameters: {},
    execute: async () => {
      expect(session.nodeScopeIdentity).toBeTruthy()
      return { content: [] }
    },
  }
  const wrapped = (
    session as unknown as { wrapToolsForSession(tools: AgentTool[]): AgentTool[] }
  ).wrapToolsForSession([tool])
  await wrapped[0].execute('sample-call', {}, undefined, {
    approved: true,
    scope: session.scopeResolver,
    interactive: true,
  })
})
it('preserves shared folder identity on rename and restores grants when scope is re-added', async () => {
  await folders.create('', 'Collection')
  const entries = [{ kind: 'node' as const, node_id: 'sample-node', access: 'read' as const }]
  await folders.setNodeScope('Collection', entries)
  const owner = folders.nodeScopeOwner('Collection')
  const ledger = () =>
    new NodeScopeLedger({
      read: () => app.loadLocalStorage('abele-chat-node-scope-approvals'),
      write: (value) => app.saveLocalStorage('abele-chat-node-scope-approvals', value),
    })
  ledger().approve(owner, { 'sample-node': 'sample-installation' })
  await folders.rename('Collection', 'Archive')
  expect(folders.nodeScopeIdentity('Archive')).toBe(owner.nodeScopeIdentity)
  expect(owner.overrides.value.nodeScope).toEqual(entries)
  expect(ledger().approvedNode(owner, 'sample-node', 'sample-installation')).toBe(true)
  await folders.setNodeScope('Archive', [])
  expect(ledger().approvedNode(owner, 'sample-node', 'sample-installation')).toBe(false)
  await folders.setNodeScope('Archive', entries)
  expect(ledger().approvedNode(owner, 'sample-node', 'sample-installation')).toBe(true)
})
it('stores node scope in the catalog and inherits all ancestors without enabling commands', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  await folders.setNodeScope('Projects', [{ kind: 'node', node_id: 'sample-node', access: 'read' }])
  const id = service.createTab()
  const session = service.getSession(id)!
  await folders.move(id, 'Projects/Drafts')
  expect(session.inheritedNodeScopes[0].entries).toEqual([
    { kind: 'node', node_id: 'sample-node', access: 'read' },
  ])
  expect(session.getToolMode('node_command_run')).toBe('off')
  expect(session.getToolMode('node_delegate')).toBe('off')
  await folders.reload()
  expect(folders.nodeScopeForFolder('Projects')).toHaveLength(1)
  await folders.move(id, '')
  expect(session.inheritedNodeScopes).toEqual([])
})
it('stores tree folders without creating disk directories', async () => {
  await folders.create('', 'Collection')
  expect(app.vault.getAbstractFileByPath('AI/Chats/Collection')).toBeNull()
})

it('keeps a filed chat at its original path when moving and renaming its tree folder', async () => {
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  const rename = vi.spyOn(app.fileManager, 'renameFile')
  await folders.create('', 'Collection')
  await folders.move(file.path, 'Collection')
  await folders.rename('Collection', 'Archive')
  expect(file.path).toBe('AI/Chats/sample.abchat')
  expect(folders.folderOf(file.path)).toBe('Archive')
  expect(rename).not.toHaveBeenCalled()
})
it('does not reserve a session-owned file for an unrelated no-op rename', async () => {
  const file = app.vault.getFiles().find((file) => file.extension === 'abchat')!
  const gate = vi.fn(() => {
    throw new Error('A session owns this file')
  })
  await expect(
    ChatStorage.getInstance().transformDiscussion(file, (content) => content, gate)
  ).resolves.toBeUndefined()
  expect(gate).not.toHaveBeenCalled()
})
beforeEach(() => {
  const content = serializeChat({
    metadata: {
      type: 'abele-chat',
      title: 'Sample',
      created: '2025-01-01',
      providerId: '',
      modelId: '',
    },
    messages: [],
    internalMessages: [],
  })
  app = useVault([
    { path: 'AI/Chats/sample.abchat', content },
    {
      path: 'AI/Chats/reply.abchat',
      content: serializeChat({
        metadata: {
          type: 'abele-chat',
          title: 'Sample discussion',
          created: '2025-01-01',
          providerId: '',
          modelId: '',
          kind: 'chat',
          commentId: 'sample-discussion',
          commentLocation: 'AI/Chats/reply.abchat',
          anchor: { note: 'AI/Chats/sample.abchat', quote: 'Sample passage' },
        },
        messages: [],
        internalMessages: [],
      }),
    },
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  service = ChatService.getInstance()
  folders = service.folders
  Object.assign(app.workspace, { iterateAllLeaves: vi.fn() })
})
afterEach(() => {
  folders?.destroy()
  service.destroy()
  CommentService.getInstance().destroy()
  vi.restoreAllMocks()
})

it('creates nested logical folders, refuses traversal and reparents children on deletion', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  expect(folders.paths).toContain('Projects/Drafts')
  await expect(folders.create('', '../outside')).rejects.toThrow()
  await folders.remove('Projects')
  expect(folders.paths).toEqual(['Drafts'])
})

it('moves membership without touching file paths and removes inherited access when leaving', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const session = service.getSession(id)!
  session.currentChatFile.value = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  vi.spyOn(session, 'saveForRelease').mockResolvedValue()
  await folders.move(id, 'Projects')
  expect(session.currentChatFile.value?.path).toBe('AI/Chats/sample.abchat')
  expect(session.toolModes.value.web_search).toBe('auto')
  await folders.move(id, '')
  expect(session.toolModes.value.web_search).not.toBe('auto')
})

it('inherits additive access from every ancestor and persists it in the vault', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  await folders.setAccess('Projects', { web_search: 'auto' })
  await folders.setAccess('Projects/Drafts', { web_search: 'off', fetch_url: 'auto' })
  await folders.move('AI/Chats/sample.abchat', 'Projects/Drafts')
  const access = folders.accessFor('AI/Chats/sample.abchat', { web_search: 'ask' })
  expect(access.modes).toEqual({ web_search: 'auto', fetch_url: 'auto' })
  expect(access.raisedBy.web_search).toBe('Projects')
  expect(app.vault.getAbstractFileByPath('AI/Chats/_folders.abelechats')).toBeTruthy()
  await folders.reload()
  expect(folders.accessFor('AI/Chats/sample.abchat', {}).modes.web_search).toBe('auto')
})

it('moves a closed parent and its closed discussion together without opening tabs', async () => {
  await folders.create('', 'Projects')
  await folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  expect(app.vault.getAbstractFileByPath('AI/Chats/sample.abchat')).toBeTruthy()
  expect(app.vault.getAbstractFileByPath('AI/Chats/reply.abchat')).toBeTruthy()
  const reply = app.vault.getAbstractFileByPath('AI/Chats/reply.abchat') as TFile
  expect(parseChatMetadata(await app.vault.read(reply))?.anchor?.note).toBe(
    'AI/Chats/sample.abchat'
  )
  expect(service.tabOrder.value).toEqual([])
})

it('keeps moved discussions attached when their source chat is renamed later', async () => {
  await folders.create('', 'Projects')
  await folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  const parent = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await app.fileManager.renameFile(parent, 'AI/Chats/renamed.abchat')
  await CommentService.getInstance().handleRename('AI/Chats/sample.abchat', parent.path)
  const reply = app.vault.getAbstractFileByPath('AI/Chats/reply.abchat') as TFile
  expect(parseChatMetadata(await app.vault.read(reply))?.anchor?.note).toBe(parent.path)
})

it('creates a blank chat directly in a folder and applies access to its first turn', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const session = service.getSession(id)!
  await folders.move(id, 'Projects')
  await session.createInDirectory(folders.path(''))
  expect(session.currentChatFile.value?.path).toContain('AI/Chats/')
  expect(
    parseChatMetadata(await app.vault.read(session.currentChatFile.value!))?.treeFolderId
  ).toBeTruthy()
  expect(session.needsApproval('web_search')).toBe(false)
  expect(session.overrides.value.toolModes?.web_search).toBeUndefined()
  await service.closeTab(id)
  expect(await service.reopenClosedTab()).toBe(true)
  expect(service.activeSession.value?.toolModes.value.web_search).toBe('auto')
})

it('creates a new discussion in its configured storage with logical parent access and retains it after closing', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const parent = service.getSession(id)!
  await folders.move(id, 'Projects')
  await parent.createInDirectory(folders.path(''))
  await parent.addUserNote('Sample question')
  vi.spyOn(service, 'revealSidebar').mockResolvedValue()
  const child = await CommentService.getInstance().createOnMessage(
    parent,
    parent.messages.value[0].id
  )
  expect(child?.currentChatFile.value?.path).toContain('AI/Comments/')
  expect(child?.toolModes.value.web_search).toBe('auto')
  const childPath = child!.currentChatFile.value!.path
  await service.closeTab(child!.id)
  await service.tree.refresh()
  expect(chatsOf(service.tree.root.value).find((chat) => chat.id === childPath)).toMatchObject({
    open: false,
    nested: 'discussion',
  })
})

it('renames folders without losing closed-chat reopen history or inherited access', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const session = service.getSession(id)!
  await folders.move(id, 'Projects')
  await session.createInDirectory(folders.path(''))
  await service.closeTab(id)
  await folders.rename('Projects', 'Renamed')
  expect(await service.reopenClosedTab()).toBe(true)
  expect(service.activeSession.value?.currentChatFile.value?.path).toContain('AI/Chats/')
  expect(folders.folderOf(service.activeSession.value!.currentChatFile.value!.path)).toBe('Renamed')
  expect(service.activeSession.value?.toolModes.value.web_search).toBe('auto')
})

it('does not overwrite same-named disk files when filing a chat', async () => {
  await folders.create('', 'Projects')
  await app.vault.createFolder('AI/Chats/Projects')
  await app.vault.create('AI/Chats/Projects/reply.abchat', 'existing')
  await folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  const occupied = app.vault.getAbstractFileByPath('AI/Chats/Projects/reply.abchat') as TFile
  expect(await app.vault.read(occupied)).toBe('existing')
  expect(folders.folderOf('AI/Chats/reply.abchat')).toBe('Projects')
})

it('finishes rapid moves in the order they were requested', async () => {
  await folders.create('', 'First')
  await folders.create('', 'Second')
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await Promise.all([folders.move(file.path, 'First'), folders.move(file.path, 'Second')])
  expect(file.path).toBe('AI/Chats/sample.abchat')
  expect(folders.folderOf(file.path)).toBe('Second')
})

it('deleting a nonempty folder reparents chats and survives reload', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  await folders.move('AI/Chats/sample.abchat', 'Projects/Drafts')
  await folders.remove('Projects/Drafts')
  await folders.reload()
  expect(folders.folderOf('AI/Chats/sample.abchat')).toBe('Projects')
  expect(app.vault.getAbstractFileByPath('AI/Chats/sample.abchat')).toBeTruthy()
})

it('keeps membership after external file renames and ordinary session saves', async () => {
  await folders.create('', 'Projects')
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.createInDirectory(folders.path(''))
  await folders.move(id, 'Projects')
  await session.addUserNote('Sample question')
  const file = session.currentChatFile.value!
  await app.fileManager.renameFile(file, 'AI/Chats/renamed.abchat')
  await folders.reload()
  expect(folders.folderOf(file.path)).toBe('Projects')
  expect(parseChatMetadata(await app.vault.read(file))?.treeFolderId).toBeTruthy()
})

it('hides template directories and places unfiled chats at root', async () => {
  await app.vault.createFolder('AI/Chats/2025-04')
  await folders.reload()
  await service.tree.refresh()
  expect(service.tree.root.value.every((entry) => entry.kind === 'chat')).toBe(true)
})

it('files an unsaved tab without creating a chat file', async () => {
  await folders.create('', 'Projects')
  const before = app.vault.getFiles().map((file) => file.path)
  const id = service.createTab()
  await folders.move(id, 'Projects')
  expect(service.getSession(id)!.currentChatFile.value).toBeNull()
  expect(app.vault.getFiles().map((file) => file.path)).toEqual(before)
  expect(service.listOpenChats().find((chat) => chat.id === id)?.folder).toBe('Projects')
})

it('uses the configured month template for the first save of a filed tab', async () => {
  AbeleConfig.getInstance().ai.chatFolder = 'AI/Chats/{{date:YYYY-MM}}/{{name}}'
  await folders.create('', 'Projects')
  const id = service.createTab()
  await folders.move(id, 'Projects')
  const session = service.getSession(id)!
  await session.addUserNote('Sample question')
  expect(session.currentChatFile.value?.path).toMatch(/^AI\/Chats\/\d{4}-\d{2}\//)
  expect(folders.folderOf(session.currentChatFile.value!.path)).toBe('Projects')
})

it('keeps child folders distinct when deleting their parent would collide with a sibling', async () => {
  await folders.create('', 'Drafts')
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  await folders.move('AI/Chats/sample.abchat', 'Projects/Drafts')
  await folders.remove('Projects')
  expect(new Set(folders.paths).size).toBe(folders.paths.length)
  expect(folders.paths).toHaveLength(2)
  expect(folders.folderOf('AI/Chats/sample.abchat')).not.toBe('Drafts')
})

it('reports current membership after moving a chat that was filed before its first save', async () => {
  await folders.create('', 'First')
  await folders.create('', 'Second')
  const id = service.createTab()
  await folders.move(id, 'First')
  await service.getSession(id)!.addUserNote('Sample question')
  await folders.move(id, 'Second')
  expect(service.listOpenChats().find((chat) => chat.id === id)?.folder).toBe('Second')
})

it('ignores existing disk folders and access markers without writing any files', async () => {
  await app.vault.createFolder('AI/Chats/Existing/Nested')
  const chat = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await app.fileManager.renameFile(chat, 'AI/Chats/Existing/Nested/sample.abchat')
  await app.vault.create('AI/Chats/Existing/_folder.abeleaccess', '{"web_search":"auto"}')
  await app.vault.create('AI/Chats/Existing/Nested/_folder.abeleaccess', '{"fetch_url":"auto"}')
  const before = await Promise.all(
    app.vault.getFiles().map(async (file) => [file.path, await app.vault.read(file)])
  )
  const rename = vi.spyOn(app.fileManager, 'renameFile')
  const trash = vi.spyOn(app.fileManager, 'trashFile')
  await folders.reload()
  expect(folders.paths).toEqual([])
  expect(folders.folderOf(chat.path)).toBe('')
  expect(folders.accessFor(chat.path, {}).modes).toEqual({})
  expect(app.vault.getAbstractFileByPath('AI/Chats/_folders.abelechats')).toBeNull()
  expect(
    await Promise.all(
      app.vault.getFiles().map(async (file) => [file.path, await app.vault.read(file)])
    )
  ).toEqual(before)
  expect(app.vault.getAbstractFileByPath('AI/Chats/Existing/Nested')).toBeTruthy()
  expect(rename).not.toHaveBeenCalled()
  expect(trash).not.toHaveBeenCalled()
  await service.tree.refresh()
  expect(service.tree.root.value.every((entry) => entry.kind === 'chat')).toBe(true)
})

it('stores membership in the transcript and shows unknown folder ids at root', async () => {
  await folders.create('', 'Projects')
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await folders.move(file.path, 'Projects')
  const metadata = parseChatMetadata(await app.vault.read(file))!
  const catalog = app.vault.getAbstractFileByPath('AI/Chats/_folders.abelechats') as TFile
  const data = JSON.parse(await app.vault.read(catalog))
  expect(metadata.treeFolderId).toBe(
    data.folders.find((folder: { name: string }) => folder.name === 'Projects').id
  )
  expect(await app.vault.read(catalog)).not.toContain(file.path)
  await app.vault.modify(
    file,
    serializeChat({
      metadata: { ...metadata, treeFolderId: 'unknown-folder' },
      messages: [],
      internalMessages: [],
    })
  )
  app.emit('vault', 'modify', file)
  await folders.reload()
  expect(folders.folderOf(file.path)).toBe('')
  await service.tree.refresh()
  expect(service.tree.root.value).toContainEqual(
    expect.objectContaining({ kind: 'chat', id: file.path })
  )
  expect(parseChatMetadata(await app.vault.read(file))?.treeFolderId).toBe('unknown-folder')
})

it('files an open chat with unsaved edits through its own save, so it can still be reopened', async () => {
  await folders.create('', 'Collection')
  const id = (await service.newTab())!
  const session = service.getSession(id)!
  session.chatTitle.value = 'Sample open chat'
  await session.createInDirectory(folders.path(''))
  const file = session.currentChatFile.value!
  await folders.move(id, 'Collection')
  expect(folders.folderOf(file.path)).toBe('Collection')
  expect(parseChatMetadata(await app.vault.read(file))?.treeFolderId).toBeTruthy()
  session.chatTitle.value = 'Renamed open chat'
  // Unsaved local work, as a chat that is being typed in has.
  ;(session as unknown as { dirty: boolean }).dirty = true
  await expect(session.reconcileForSelectionReturn()).resolves.toBeUndefined()
  await session.save()
  await folders.move(id, '')
  expect(folders.folderOf(file.path)).toBe('')
  expect(parseChatMetadata(await app.vault.read(file))?.treeFolderId).toBeNull()
  await expect(session.reconcileForSelectionReturn()).resolves.toBeUndefined()
})
