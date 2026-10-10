import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(ChatService.getInstance(), 'ensureInitialized').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
it('presents one retry error and acknowledges failures only when the chat is presented', async () => {
  const seen = vi.fn().mockResolvedValue(undefined)
  const session = fakeChatSession({
    overrides: {
      error: ref('Synthetic failure'),
      retrying: ref(null),
      attention: ref({ errors: [{ id: 'failure', at: 1, text: 'Synthetic failure' }] }),
      markFailuresSeen: seen,
    },
  })
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: session,
  } as never)
  const wrapper = mount(AiChat)
  await flushPromises()
  expect(wrapper.findAll('.abele-ai-chat__error')).toHaveLength(1)
  expect(wrapper.get('.abele-ai-chat__error').text()).toContain('Synthetic failure')
  expect(wrapper.get('.abele-ai-chat__error button').text()).toBe('Retry')
  expect(seen).toHaveBeenCalledOnce()
  wrapper.unmount()
})
