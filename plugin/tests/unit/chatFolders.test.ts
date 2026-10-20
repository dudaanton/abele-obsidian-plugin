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

it('creates nested real folders and refuses traversal or deleting a nonempty folder', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  expect(app.vault.getAbstractFileByPath('AI/Chats/Projects/Drafts')).toBeTruthy()
  await expect(folders.create('', '../outside')).rejects.toThrow()
  await expect(folders.remove('Projects')).rejects.toThrow()
})

it('moves files without overwriting and removes inherited access when leaving', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const session = service.getSession(id)!
  session.currentChatFile.value = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  vi.spyOn(session, 'saveForRelease').mockResolvedValue()
  await folders.move(id, 'Projects')
  expect(session.currentChatFile.value?.path).toBe('AI/Chats/Projects/sample.abchat')
  expect(session.toolModes.value.web_search).toBe('auto')
  await folders.move(id, '')
  expect(session.toolModes.value.web_search).not.toBe('auto')
})

it('inherits additive access from every ancestor and persists it in the vault', async () => {
  await folders.create('', 'Projects')
  await folders.create('Projects', 'Drafts')
  await folders.setAccess('Projects', { web_search: 'auto' })
  await folders.setAccess('Projects/Drafts', { web_search: 'off', fetch_url: 'auto' })
  const access = folders.accessFor('AI/Chats/Projects/Drafts/sample.abchat', { web_search: 'ask' })
  expect(access.modes).toEqual({ web_search: 'auto', fetch_url: 'auto' })
  expect(access.raisedBy.web_search).toBe('Projects')
  expect(app.vault.getAbstractFileByPath('AI/Chats/Projects/_folder.abeleaccess')).toBeTruthy()
  await folders.reload()
  expect(folders.accessFor('AI/Chats/Projects/new.abchat', {}).modes.web_search).toBe('auto')
})

it('moves a closed parent and its closed discussion together without opening tabs', async () => {
  await folders.create('', 'Projects')
  await folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  expect(app.vault.getAbstractFileByPath('AI/Chats/Projects/sample.abchat')).toBeTruthy()
  expect(app.vault.getAbstractFileByPath('AI/Chats/Projects/reply.abchat')).toBeTruthy()
  const reply = app.vault.getAbstractFileByPath('AI/Chats/Projects/reply.abchat') as TFile
  expect(parseChatMetadata(await app.vault.read(reply))?.anchor?.note).toBe(
    'AI/Chats/Projects/sample.abchat'
  )
  expect(service.tabOrder.value).toEqual([])
})

it('keeps moved discussions attached when their source chat is renamed later', async () => {
  await folders.create('', 'Projects')
  await folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  const parent = app.vault.getAbstractFileByPath('AI/Chats/Projects/sample.abchat') as TFile
  await app.fileManager.renameFile(parent, 'AI/Chats/Projects/renamed.abchat')
  await CommentService.getInstance().handleRename('AI/Chats/Projects/sample.abchat', parent.path)
  const reply = app.vault.getAbstractFileByPath('AI/Chats/Projects/reply.abchat') as TFile
  expect(parseChatMetadata(await app.vault.read(reply))?.anchor?.note).toBe(parent.path)
})

it('creates a blank chat directly in a folder and applies access to its first turn', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const session = service.getSession(id)!
  await session.createInDirectory(folders.path('Projects'))
  expect(session.currentChatFile.value?.path).toContain('AI/Chats/Projects/')
  expect(session.needsApproval('web_search')).toBe(false)
  expect(session.overrides.value.toolModes?.web_search).toBeUndefined()
  await service.closeTab(id)
  expect(await service.reopenClosedTab()).toBe(true)
  expect(service.activeSession.value?.toolModes.value.web_search).toBe('auto')
})

it('creates a new discussion beside its filed parent and retains it after closing', async () => {
  await folders.create('', 'Projects')
  await folders.setAccess('Projects', { web_search: 'auto' })
  const id = service.createTab()
  const parent = service.getSession(id)!
  await parent.createInDirectory(folders.path('Projects'))
  await parent.addUserNote('Sample question')
  vi.spyOn(service, 'revealSidebar').mockResolvedValue()
  const child = await CommentService.getInstance().createOnMessage(
    parent,
    parent.messages.value[0].id
  )
  expect(child?.currentChatFile.value?.path).toContain('AI/Chats/Projects/')
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
  await session.createInDirectory(folders.path('Projects'))
  await service.closeTab(id)
  await folders.rename('Projects', 'Renamed')
  expect(await service.reopenClosedTab()).toBe(true)
  expect(service.activeSession.value?.currentChatFile.value?.path).toContain('AI/Chats/Renamed/')
  expect(service.activeSession.value?.toolModes.value.web_search).toBe('auto')
})

it('preflights every destination before moving any file', async () => {
  await folders.create('', 'Projects')
  await app.vault.create('AI/Chats/Projects/reply.abchat', 'existing')
  await expect(
    folders.moveMany(['AI/Chats/sample.abchat', 'AI/Chats/reply.abchat'], 'Projects')
  ).rejects.toThrow()
  expect(app.vault.getAbstractFileByPath('AI/Chats/sample.abchat')).toBeTruthy()
  expect(app.vault.getAbstractFileByPath('AI/Chats/reply.abchat')).toBeTruthy()
})

it('finishes rapid moves in the order they were requested', async () => {
  await folders.create('', 'First')
  await folders.create('', 'Second')
  const file = app.vault.getAbstractFileByPath('AI/Chats/sample.abchat') as TFile
  const rename = app.fileManager.renameFile.bind(app.fileManager)
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const spy = vi
    .spyOn(app.fileManager, 'renameFile')
    .mockImplementation(async (target, destination) => {
      if (destination.includes('/First/')) await barrier
      await rename(target, destination)
    })
  const first = folders.moveMany([file.path], 'First')
  await vi.waitFor(() => expect(spy).toHaveBeenCalled())
  const second = folders.moveMany([file.path], 'Second')
  await Promise.resolve()
  release()
  await Promise.all([first, second])
  expect(file.path).toBe('AI/Chats/Second/sample.abchat')
})
