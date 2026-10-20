import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import { TFile } from 'obsidian'

let service: ChatService
let app: FakeApp
beforeEach(() => {
  app = useVault([{ path: 'AI/Chats/Projects/sample.abchat', content: '' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  service = ChatService.getInstance()
})
afterEach(() => service.destroy())

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
