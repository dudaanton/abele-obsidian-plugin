import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, shallowRef, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'
import ChatFindBar from '@/components/ChatFindBar.vue'
import ChatNavigation from '@/components/ChatNavigation.vue'
import AiChatSetup from '@/components/AiChatSetup.vue'
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
        AiChatInput: {
          name: 'AiChatInput',
          template: '<div />',
          methods: { focus: vi.fn(), hasFocus: () => true },
        },
      },
    },
  })
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue()
  active.value = fakeChatSession({ kind: 'chat' }) as ChatSession
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active as never)
})
afterEach(() => {
  view?.unmount()
  vi.restoreAllMocks()
})
describe('the compact chat header', () => {
  it('keeps new chat direct and moves settings into the overflow kit', async () => {
    view = mountChat()
    const overflow = view.findComponent(SheetHeaderActions)
    expect(overflow.exists()).toBe(true)
    expect(overflow.props('actions')).toEqual([
      { id: 'find', label: 'Find in this chat', icon: 'search' },
      { id: 'navigation', label: 'Navigation', icon: 'list-tree' },
      {
        id: 'setup',
        label: 'Scope, skills, prompts, permissions and settings',
        icon: 'sliders-horizontal',
      },
    ])
    expect(view.get('[tooltip="Start a new chat"]').classes()).not.toContain(
      'abele-ai-chat__secondary-action'
    )
    overflow.vm.$emit('action', 'setup')
    await nextTick()
    expect(view.findComponent(AiChatSetup).exists()).toBe(true)
    overflow.vm.$emit('action', 'find')
    await nextTick()
    expect(view.findComponent(ChatFindBar).exists()).toBe(true)
    overflow.vm.$emit('action', 'navigation')
    await nextTick()
    expect(view.findComponent(ChatNavigation).exists()).toBe(true)
  })
  it('also offers both comment actions without losing the blocked promotion state', () => {
    active.value = fakeChatSession({ kind: 'comment', overrides: { moving: ref(true) } }) as ChatSession
    view = mountChat()
    const actions = view.findComponent(SheetHeaderActions).props('actions')
    expect(actions).toEqual(expect.arrayContaining([
      { id: 'back', label: 'Back to the passage this is about', icon: 'corner-up-left' },
      expect.objectContaining({ id: 'promote', icon: 'messages-square', disabled: true }),
    ]))
  })
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
  it('leaves the expanded composer before showing a source message', async () => {
    view = mountChat()
    const composer = view.findComponent({ name: 'AiChatInput' })
    composer.vm.$emit('update:expanded', true)
    await nextTick()
    expect(view.classes()).toContain('abele-ai-chat--composing')
    expect(view.find('.abele-ai-chat__messages').attributes('style')).toContain('display: none')
    await view.find('.abele-ai-chat__artifacts').trigger('click')
    view.findComponent(ChatArtifacts).vm.$emit('reveal', 'sample-source')
    await nextTick()
    expect(view.classes()).not.toContain('abele-ai-chat--composing')
    expect(view.find('.abele-ai-chat__messages').attributes('style') ?? '').not.toContain(
      'display: none'
    )
    expect(view.findComponent(ChatArtifacts).exists()).toBe(false)
  })
  it('reveals the chat panel without focusing input when navigating back from an artifact', async () => {
    view = mountChat()
    await view.find('.abele-ai-chat__artifacts').trigger('click')
    view.findComponent(ChatArtifacts).vm.$emit('reveal', 'sample-source')
    await nextTick()
    expect(ChatService.getInstance().revealSidebar).toHaveBeenCalledExactlyOnceWith({ focus: false })
  })
  it('closes when the originating session disappears', async () => {
    view = mountChat()
    await view.find('.abele-ai-chat__artifacts').trigger('click')
    active.value = undefined
    await nextTick()
    expect(view.findComponent(ChatArtifacts).exists()).toBe(false)
  })
})
