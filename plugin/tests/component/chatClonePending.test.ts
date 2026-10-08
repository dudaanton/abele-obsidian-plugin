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
})
afterEach(() => vi.restoreAllMocks())

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
