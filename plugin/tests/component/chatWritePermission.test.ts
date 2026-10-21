import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))

it('shows automatic writes in Access and leaves restoring prompting to setup', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const permissionMode = ref('allow-edit')
  const session = fakeChatSession({ kind: 'chat', overrides: { permissionMode } })
  const service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a']
  service.activeTabId.value = 'tab-a'
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  const wrapper = mount(AiChat, { global: { stubs: { AiChatSetup: true } } })
  try {
    await nextTick()
    expect(wrapper.find('.abele-chat-write-permission').exists()).toBe(false)
    const access = wrapper.get('.abele-chat-input__scope')
    expect(access.attributes('aria-label')).toContain('Writes without asking')
    await access.trigger('click')
    expect(wrapper.getComponent({ name: 'AiChatSetup' }).props('open')).toBe('scope')
    expect(permissionMode.value).toBe('allow-edit')
    permissionMode.value = 'confirm-all'
    await nextTick()
    expect(access.find('.abele-chat-input__scope-mode').exists()).toBe(false)
  } finally {
    wrapper.unmount()
    vi.restoreAllMocks()
  }
})
