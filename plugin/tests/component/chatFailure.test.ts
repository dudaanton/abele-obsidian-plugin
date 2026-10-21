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
it('uses a waiting indicator until automatic retries finish', async () => {
  const retrying = ref<{ secondsLeft: number; attempt: number; of: number } | null>({
    secondsLeft: 3,
    attempt: 1,
    of: 2,
  })
  const session = fakeChatSession({ overrides: { error: ref('Service unavailable'), retrying } })
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: session,
  } as never)
  const wrapper = mount(AiChat)
  try {
    expect(wrapper.get('.abele-ai-chat__error-dot').classes()).toContain(
      'abele-ai-chat__error-dot_retrying'
    )
    retrying.value = null
    await flushPromises()
    expect(wrapper.get('.abele-ai-chat__error-dot').classes()).not.toContain(
      'abele-ai-chat__error-dot_retrying'
    )
  } finally {
    wrapper.unmount()
  }
})
it('presents one retry error and acknowledges failures only when the chat is presented', async () => {
  const seen = vi.fn().mockResolvedValue(undefined)
  const session = fakeChatSession({
    overrides: {
      error: ref('Synthetic failure'),
      retrying: ref(null),
      attention: ref({
        run: { id: 'failed-run', at: 1, status: 'interrupted' },
        errors: [{ id: 'failure', at: 2, text: 'Synthetic failure' }],
      }),
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
  expect(wrapper.get('.abele-ai-chat__error button.mod-cta').text()).toBe('Retry')
  expect(seen).toHaveBeenCalledOnce()
  wrapper.unmount()
})
