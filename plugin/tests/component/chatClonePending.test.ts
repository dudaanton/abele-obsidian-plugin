import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  ChatService.getInstance().pendingInput.value = null
})
afterEach(() => {
  ChatService.getInstance().pendingInput.value = null
  vi.restoreAllMocks()
})

it('delivers pending text and a picture when the clone editor mounts without a tab or lifetime change', async () => {
  useVault([{ path: 'Attachments/sample-picture.png', raw: 'sample picture bytes' }])
  const service = ChatService.getInstance()
  const preparingClone = ref(true)
  const session = fakeChatSession({ kind: 'chat', overrides: { preparingClone } })
  session.draft.value.text = 'Existing draft'
  service.tabOrder.value = ['sample-pending-tab']
  service.activeTabId.value = 'sample-pending-tab'
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  const wrapper = mount(AiChat)
  const settle = async () => {
    for (let i = 0; i < 4; i++) await nextTick()
  }
  try {
    service.pendingInput.value = {
      text: 'Inspect this picture',
      tabId: 'sample-pending-tab',
      conversationVersion: session.conversationVersion.value,
      append: true,
      attachments: ['Attachments/sample-picture.png'],
    }
    await settle()
    expect(wrapper.findComponent(AiChatInput).exists()).toBe(false)
    expect(service.pendingInput.value).not.toBeNull()
    const version = session.conversationVersion.value
    preparingClone.value = false
    await settle()
    expect(service.activeTabId.value).toBe('sample-pending-tab')
    expect(session.conversationVersion.value).toBe(version)
    expect((wrapper.get('.abele-chat-input__textarea').element as HTMLTextAreaElement).value).toBe(
      'Existing draft\nInspect this picture'
    )
    expect(wrapper.find('.abele-chat-input__attachment').exists()).toBe(true)
    expect(
      wrapper
        .getComponent(AiChatInput)
        .vm.takeDraft()
        .attachments.map((file) => file.path)
    ).toEqual(['Attachments/sample-picture.png'])
    expect(service.pendingInput.value).toBeNull()
  } finally {
    wrapper.unmount()
  }
})

it('shows a pending copy as read-only, with no composer or editable chat controls', async () => {
  const service = ChatService.getInstance()
  const preparingClone = ref(true)
  const session = fakeChatSession({ kind: 'chat', overrides: { preparingClone } })
  service.tabOrder.value = ['sample-pending-tab']
  service.activeTabId.value = 'sample-pending-tab'
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  const wrapper = mount(AiChat)
  try {
    expect(wrapper.findComponent(AiChatInput).exists()).toBe(false)
    expect(wrapper.find('.abele-ai-chat__header').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain('Creating chat copy')
    preparingClone.value = false
    await nextTick()
    expect(wrapper.findComponent(AiChatInput).exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})
