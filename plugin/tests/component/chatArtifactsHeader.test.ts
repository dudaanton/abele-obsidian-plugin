import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, shallowRef, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'
import ChatFindBar from '@/components/ChatFindBar.vue'
import ChatNavigation from '@/components/chatOutline/ChatOutlineDialog.vue'
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
  it('keeps find and outline available when the narrow header hides their buttons', async () => {
    const callbacks: (() => void)[] = []
    const resized = () => callbacks.forEach((callback) => callback())
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )
    try {
      view = mountChat()
      await nextTick()
      const find = view.get('.abele-ai-chat__find').element as HTMLElement
      expect(callbacks.length).toBeGreaterThan(0)
      find.style.display = 'none'
      vi.spyOn(find.ownerDocument.defaultView!, 'getComputedStyle').mockImplementation(
        (element) => ({ display: (element as HTMLElement).style.display }) as CSSStyleDeclaration
      )
      resized()
      await nextTick()
      expect(view.findComponent(SheetHeaderActions).props('actions')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'find' }),
          expect.objectContaining({ id: 'outline' }),
        ])
      )
      find.style.display = ''
      resized()
      await nextTick()
      expect(
        view
          .findComponent(SheetHeaderActions)
          .props('actions')
          .some((a) => a.id === 'find')
      ).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('keeps find, outline and new chat direct, with history in the overflow kit', async () => {
    view = mountChat()
    for (const tooltip of ['Find in this chat', 'Outline of this chat', 'Start a new chat'])
      expect(view.find(`[tooltip="${tooltip}"]`).exists()).toBe(true)
    const overflow = view.findComponent(SheetHeaderActions)
    expect(view.find('[tooltip="Open a chat you have had"]').exists()).toBe(false)
    expect(overflow.props('actions').map((a) => [a.id, a.section ?? ''])).toEqual([
      ['history', ''],
      ['setup', ''],
      ['artifacts', ''],
      ['agents', ''],
      ['reload', 'file'],
      ['debug', 'file'],
      ['delete', 'danger'],
    ])
    overflow.vm.$emit('action', 'setup')
    await nextTick()
    expect(view.findComponent(AiChatSetup).exists()).toBe(true)
    await view.get('[tooltip="Find in this chat"]').trigger('click')
    await nextTick()
    expect(view.findComponent(ChatFindBar).exists()).toBe(true)
    await view.get('[tooltip="Outline of this chat"]').trigger('click')
    await nextTick()
    expect(view.findComponent(ChatNavigation).exists()).toBe(true)
  })
  it('also offers both comment actions without losing the blocked promotion state', () => {
    active.value = fakeChatSession({
      kind: 'comment',
      overrides: { moving: ref(true) },
    }) as ChatSession
    view = mountChat()
    const actions = view.findComponent(SheetHeaderActions).props('actions')
    expect(view.find('[tooltip="Back to the passage this is about"]').exists()).toBe(true)
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'promote', icon: 'messages-square', disabled: true }),
      ])
    )
    expect(actions.some((a) => a.id === 'artifacts')).toBe(false)
  })
})

/** Deleting is done to the chat, once in a while: last in the ⋯, warning, after Obsidian asks. */
describe('throwing a chat away', () => {
  const withFile = () => {
    active.value = fakeChatSession({
      kind: 'chat',
      overrides: { currentChatFile: ref({ path: 'Chats/sample.md' }) },
    }) as ChatSession
  }
  const action = (id: string) =>
    view
      .findComponent(SheetHeaderActions)
      .props('actions')
      .find((a) => a.id === id)

  it('offers it as the destructive act it is', () => {
    withFile()
    view = mountChat()
    expect(action('delete')).toMatchObject({ warning: true, disabled: false })
  })

  it('asks first, deletes this chat on yes and nothing on no', async () => {
    withFile()
    const deleteChat = vi
      .spyOn(ChatService.getInstance(), 'deleteChat')
      .mockResolvedValue(true as never)
    view = mountChat()
    view.findComponent(SheetHeaderActions).vm.$emit('action', 'delete')
    await nextTick()
    const confirm = view.findComponent({ name: 'ConfirmModal' })
    expect(confirm.exists()).toBe(true)
    expect(deleteChat).not.toHaveBeenCalled()
    confirm.vm.$emit('close')
    await nextTick()
    expect(deleteChat).not.toHaveBeenCalled()
    view.findComponent(SheetHeaderActions).vm.$emit('action', 'delete')
    await nextTick()
    view.findComponent({ name: 'ConfirmModal' }).vm.$emit('confirm')
    await nextTick()
    expect(deleteChat).toHaveBeenCalledWith(active.value!.id)
  })

  /** A tab nobody has written to yet has no file, and no file is nothing to throw away. */
  it('is dark over a conversation that has never been saved', () => {
    view = mountChat()
    expect(action('delete')?.disabled).toBe(true)
    expect(action('reload')?.disabled).toBe(true)
  })
  it('dismisses deletion on a chat switch and ignores a stale confirmation', async () => {
    withFile()
    const deleteChat = vi
      .spyOn(ChatService.getInstance(), 'deleteChat')
      .mockResolvedValue(true as never)
    view = mountChat()
    view.findComponent(SheetHeaderActions).vm.$emit('action', 'delete')
    await nextTick()
    const confirm = view.findComponent({ name: 'ConfirmModal' })
    active.value = fakeChatSession({
      kind: 'chat',
      overrides: { currentChatFile: ref({ path: 'Chats/other-sample.md' }) },
    }) as ChatSession
    await nextTick()
    expect(view.findComponent({ name: 'ConfirmModal' }).exists()).toBe(false)
    confirm.vm.$emit('confirm')
    await nextTick()
    expect(deleteChat).not.toHaveBeenCalled()
  })
})

describe('the artifacts header entry', () => {
  const openArtifacts = async () => {
    view.findComponent(SheetHeaderActions).vm.$emit('action', 'artifacts')
    await nextTick()
  }
  it('opens from the overflow menu, including an unsaved chat, and closes on tab change', async () => {
    view = mountChat()
    expect(view.find('.abele-ai-chat__notes').exists()).toBe(false)
    await openArtifacts()
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
    await openArtifacts()
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
    await openArtifacts()
    view.findComponent(ChatArtifacts).vm.$emit('reveal', 'sample-source')
    await nextTick()
    expect(ChatService.getInstance().revealSidebar).toHaveBeenCalledExactlyOnceWith({
      focus: false,
    })
  })
  it('closes when the originating session disappears', async () => {
    view = mountChat()
    await openArtifacts()
    active.value = undefined
    await nextTick()
    expect(view.findComponent(ChatArtifacts).exists()).toBe(false)
  })
})
