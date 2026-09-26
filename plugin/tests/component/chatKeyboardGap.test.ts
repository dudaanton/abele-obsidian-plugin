/**
 * On a phone the chat shrinks by the part of Obsidian's `--keyboard-height` that reaches past
 * the room under its panel (`--abele-bottom-gap`). That room was measured once, on mount, and a
 * chat mounted in a panel not on screen — a closed drawer, another tab of it — measured the
 * whole window: the keyboard never reached the chat and the composer stayed under it until the
 * app was restarted (2026-09-27, iPhone). Here the phone's layout is simulated: a panel laid out
 * nowhere at mount, then on screen, and Obsidian's keyboard events on the window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import { Platform } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { bottomGapOf } from '@/composables/useChatKeyboardGap'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const WINDOW_HEIGHT = 852
/** Where the drawer's panel ends on the phone; its bar and the home indicator are below. */
const PANEL_BOTTOM = 744

let panel: HTMLElement
let panelShown = false
const mounted: Array<ReturnType<typeof mount>> = []

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 393,
    width: 393,
    x: 0,
    y: top,
  } as DOMRect
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a']
  service.activeTabId.value = 'tab-a'
  service.pendingInput.value = null
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages: ref<ChatMessage[]>([]), kind: 'chat' }),
  } as never)
  ;(Platform as { isMobile: boolean }).isMobile = true
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(WINDOW_HEIGHT)

  // The leaf's content box: positioned, as Obsidian's is, so the chat is laid out in it.
  panelShown = false
  panel = document.body.createDiv({ cls: 'workspace-leaf-content' })
  panel.style.position = 'relative'
  panel.getBoundingClientRect = () => (panelShown ? rect(59, PANEL_BOTTOM) : rect(0, 0))
})

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  panel.remove()
  ;(Platform as { isMobile: boolean }).isMobile = false
  vi.restoreAllMocks()
})

const open = () => {
  const host = panel.createDiv()
  const wrapper = mount(AiChat, { attachTo: host })
  mounted.push(wrapper)
  return wrapper
}
const chat = (w: ReturnType<typeof open>) => w.get('.abele-ai-chat').element as HTMLElement
const gap = (w: ReturnType<typeof open>) => chat(w).style.getPropertyValue('--abele-bottom-gap')

describe('the room under the chat, for the keyboard', () => {
  it('is read off the panel it is laid out in', () => {
    panelShown = true
    const el = panel.createDiv()
    expect(bottomGapOf(el)).toBe(WINDOW_HEIGHT - PANEL_BOTTOM)
  })

  it('is not read off a panel that is not laid out', () => {
    const el = panel.createDiv()
    expect(bottomGapOf(el)).toBeNull()
  })

  it('is measured on mount when the panel is on screen', async () => {
    panelShown = true
    const wrapper = open()
    await nextTick()
    await nextTick()
    expect(gap(wrapper)).toBe('108px')
  })

  it('is not taken from a panel mounted off screen, and is measured when the composer is focused', async () => {
    const wrapper = open()
    await nextTick()
    await nextTick()
    // Nothing kept from a panel laid out nowhere — the whole window read as the gap before.
    expect(gap(wrapper)).toBe('')

    const composer = wrapper.get('.abele-chat-input__textarea').element as HTMLTextAreaElement
    composer.blur() // the chat put the cursor there itself on mount
    panelShown = true
    composer.focus()
    await nextTick()

    expect(gap(wrapper)).toBe('108px')
    expect(chat(wrapper).classList.contains('abele-keyboard-open')).toBe(true)
  })

  it('is measured again when Obsidian says the keyboard is coming up', async () => {
    const wrapper = open()
    await nextTick()
    panelShown = true

    window.dispatchEvent(new Event('keyboardWillShow'))

    expect(gap(wrapper)).toBe('108px')
  })

  it('stops listening to the keyboard once the chat is gone', async () => {
    const wrapper = open()
    const el = chat(wrapper)
    await nextTick()
    wrapper.unmount()
    mounted.length = 0
    panelShown = true

    window.dispatchEvent(new Event('keyboardWillShow'))

    expect(el.style.getPropertyValue('--abele-bottom-gap')).toBe('')
  })
})
