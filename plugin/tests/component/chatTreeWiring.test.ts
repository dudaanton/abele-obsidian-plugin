import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { chatTreeSource } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'

let view: VueWrapper | undefined
afterEach(() => {
  view?.unmount()
  view = undefined
  ChatService.getInstance().destroy()
  chatTreeSource.value = null
  vi.restoreAllMocks()
})

it('moves folders through the real chat pane source and tree rows', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  await service.folders.create('', 'Sample')
  await service.folders.create('', 'Target')
  await service.tree.refresh()
  view = mount(AiChat, { attachTo: document.body })
  await view.get('.abele-chat-switch__current').trigger('click')
  await flushPromises()

  const row = view.get<HTMLElement>('.abele-chat-tree__folder[data-path="Sample"]')
  expect(row.attributes('draggable')).toBe('true')
  // Start from the visible row: the browser finds the draggable outer TreeItem.
  await row.get(':scope > .tree-item-self').trigger('dragstart')
  await view.get('.abele-chat-tree__folder[data-path="Target"] > .tree-item-self').trigger('drop')
  await flushPromises()
  expect(service.folders.paths).toContain('Target/Sample')
  expect(view.find('.abele-chat-tree__folder[data-path="Target/Sample"]').exists()).toBe(true)

  await view.get('[data-path="Target/Sample"] > .tree-item-self').trigger('dragstart')
  await view.get('.abele-chat-tree__list').trigger('drop')
  await flushPromises()
  expect(service.folders.paths).toContain('Sample')
  expect(service.folders.paths).not.toContain('Target/Sample')
})
