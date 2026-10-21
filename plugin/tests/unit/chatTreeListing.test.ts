import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import { TFile } from 'obsidian'
import { revealCurrentChat } from '@/components/chatTree/chatTreeView'

it('expands only the ancestors of the current nested chat', () => {
  const folded = new Set(['Projects', 'chat:parent', 'chat:other'])
  revealCurrentChat(
    [
      {
        kind: 'folder',
        path: 'Projects',
        name: 'Projects',
        children: [
          {
            kind: 'chat',
            id: 'parent',
            title: 'Parent',
            open: true,
            at: 0,
            children: [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 0 }],
          },
        ],
      },
    ],
    'child',
    folded
  )
  expect([...folded]).toEqual(['chat:other'])
})

let service: ChatService
let app: FakeApp
beforeEach(() => {
  app = useVault([{ path: 'AI/Chats/Projects/sample.abchat', content: '' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  service = ChatService.getInstance()
})
afterEach(() => service.destroy())

it('reveals a current descendant through a closed root group', () => {
  const folded = new Set<string>(['chat:parent'])
  revealCurrentChat(
    [
      {
        kind: 'chat',
        id: 'parent',
        title: 'Parent',
        open: false,
        at: 0,
        children: [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 0 }],
      },
    ],
    'child',
    folded
  )
  expect(folded.has('#closed')).toBe(true)
  expect(folded.has('chat:parent')).toBe(false)
})

it('keeps a nested discussion parent open when presenting its child', async () => {
  const { CommentService } = await import('@/ai/CommentService')
  const comments = CommentService.getInstance()
  const parentId = service.createTab()
  const childId = service.createTab()
  const parent = service.getSession(parentId)!
  const child = service.getSession(childId)!
  parent.kind = 'comment'
  parent.bindCommentIdentity('sample-parent')
  parent.currentChatFile.value = app.vault.getAbstractFileByPath(
    'AI/Chats/Projects/sample.abchat'
  ) as TFile
  child.kind = 'comment'
  child.bindCommentIdentity('sample-child')
  child.anchor.value = { note: parent.currentChatFile.value.path, quote: 'Sample passage' }
  vi.spyOn(comments, 'isShown').mockImplementation((id) => id === 'sample-parent')
  vi.spyOn(comments, 'showPresentationNow').mockImplementation(() => {})
  vi.spyOn(parent, 'saveForRelease').mockResolvedValue()
  await service.presentContextualSession(child, service.contextualOpenGuard(child), parent)
  expect(service.listOpenChats().map((chat) => chat.id)).toContain(parentId)
  expect(service.activeTabId.value).toBe(childId)
  comments.destroy()
})

it('lists only open chats in presentation order, with folder, agent and live state', async () => {
  const first = service.createTab()
  const second = service.createTab()
  const session = service.getSession(first)!
  session.chatTitle.value = 'Sample project'
  session.currentChatFile.value = app.vault.getAbstractFileByPath(
    'AI/Chats/Projects/sample.abchat'
  ) as TFile
  session.error.value = 'Sample failure'
  expect(service.listOpenChats()).toEqual([
    expect.objectContaining({
      id: first,
      title: 'Sample project',
      folder: 'Projects',
      agent: null,
      state: 'failed',
    }),
    expect.objectContaining({ id: second, folder: '', state: 'idle' }),
  ])
  vi.spyOn(session, 'saveForRelease').mockResolvedValue()
  await service.closeTab(first)
  expect(service.listOpenChats().map((chat) => chat.id)).toEqual([second])
})

it('closes a parent and all its nested discussions without restoring files', async () => {
  const parentId = service.createTab()
  const childId = service.createTab()
  const parent = service.getSession(parentId)!
  const child = service.getSession(childId)!
  parent.currentChatFile.value = app.vault.getAbstractFileByPath(
    'AI/Chats/Projects/sample.abchat'
  ) as TFile
  child.anchor.value = { note: parent.currentChatFile.value.path, quote: 'Sample passage' }
  vi.spyOn(parent, 'saveForRelease').mockResolvedValue()
  vi.spyOn(child, 'saveForRelease').mockResolvedValue()
  await service.closeTab(parentId)
  expect(service.getSession(parentId)).toBeNull()
  expect(service.getSession(childId)).toBeNull()
  expect(app.vault.getAbstractFileByPath('AI/Chats/Projects/sample.abchat')).toBeTruthy()
})
