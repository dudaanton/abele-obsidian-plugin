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

let service: ChatService
let folders: ChatFolders
let app: FakeApp
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

it('migrates marked folders once, preserves permissions and ignores template directories', async () => {
  await app.vault.createFolder('AI/Chats/2025-03')
  await app.vault.createFolder('AI/Chats/Legacy')
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await app.fileManager.renameFile(file, 'AI/Chats/Legacy/sample.abchat')
  await app.vault.create('AI/Chats/Legacy/_folder.abeleaccess', '{"web_search":"auto"}')
  await folders.reload()
  expect(folders.paths).toEqual(['Legacy'])
  expect(folders.folderOf(file.path)).toBe('Legacy')
  await folders.rename('Legacy', 'Migrated')
  await folders.reload()
  expect(folders.folderOf(file.path)).toBe('Migrated')
  expect(file.path).toBe('AI/Chats/Legacy/sample.abchat')
  expect(folders.accessFor(file.path, {}).modes.web_search).toBe('auto')
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

it('migrates nesting and uses the deepest marked folder without changing transcript paths', async () => {
  await app.vault.createFolder('AI/Chats/Legacy/Nested')
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  await app.fileManager.renameFile(file, 'AI/Chats/Legacy/Nested/sample.abchat')
  await app.vault.create('AI/Chats/Legacy/_folder.abeleaccess', '{"web_search":"auto"}')
  await app.vault.create('AI/Chats/Legacy/Nested/_folder.abeleaccess', '{"fetch_url":"auto"}')
  await folders.reload()
  expect(folders.folderOf(file.path)).toBe('Legacy/Nested')
  expect(folders.accessFor(file.path, {}).modes).toEqual({ web_search: 'auto', fetch_url: 'auto' })
  await folders.remove('Legacy/Nested')
  await folders.reload()
  expect(folders.paths).toEqual(['Legacy'])
  expect(folders.folderOf(file.path)).toBe('Legacy')
  expect(file.path).toBe('AI/Chats/Legacy/Nested/sample.abchat')
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
