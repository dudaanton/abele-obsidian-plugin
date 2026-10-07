import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { shallowRef, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatSession } from '@/ai/ChatSession'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
vi.mock('@/components/ChatArtifacts.vue', () => ({
  default: {
    props: ['session'],
    emits: ['close', 'reveal'],
    template: '<div class="sample-artifacts" />',
  },
}))
const active = shallowRef<ChatSession>()
let view: VueWrapper
const mountChat = () =>
  mount(AiChat, {
    shallow: true,
    global: {
      stubs: {
        AiChatInput: { template: '<div />', methods: { focus: vi.fn(), hasFocus: () => true } },
      },
    },
  })
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  active.value = fakeChatSession({ kind: 'chat' }) as ChatSession
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active as never)
})
afterEach(() => {
  view?.unmount()
  vi.restoreAllMocks()
})
describe('the artifacts header entry', () => {
  it('opens from one enabled button, including an unsaved chat, and closes on tab change', async () => {
    view = mountChat()
    expect(view.findAll('.abele-ai-chat__artifacts')).toHaveLength(1)
    expect(view.find('.abele-ai-chat__notes').exists()).toBe(false)
    await view.find('.abele-ai-chat__artifacts').trigger('click')
    expect(view.findComponent(ChatArtifacts).props('session')).toBe(active.value)
    active.value = fakeChatSession({ kind: 'chat' }) as ChatSession
    await nextTick()
    expect(view.findComponent(ChatArtifacts).exists()).toBe(false)
  })
  it('closes when the originating session disappears', async () => {
    view = mountChat()
    await view.find('.abele-ai-chat__artifacts').trigger('click')
    active.value = undefined
    await nextTick()
    expect(view.findComponent(ChatArtifacts).exists()).toBe(false)
  })
})
