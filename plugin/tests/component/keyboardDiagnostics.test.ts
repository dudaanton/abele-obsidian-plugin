/**
 * The keyboard diagnostics panel.
 *
 * No emulator raises the iPhone keyboard, so what a dialog sees there can only be learned from
 * a screenshot taken on the phone. The panel is that screenshot's content: the sizes the page
 * reports, the keyboard height Obsidian writes, the dialog and the focused field, and the
 * keyboard events as they arrive — fixed at the top of the screen, and never in the way of a
 * tap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import KeyboardDiagnostics from '@/components/KeyboardDiagnostics.vue'
import { setKeyboardDiagnostics } from '@/helpers/keyboardDiagnostics'
import { collectEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'

let wrapper: VueWrapper | null = null

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 300))
  await nextTick()
}

beforeEach(() => {
  document.documentElement.style.removeProperty('--keyboard-height')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  setKeyboardDiagnostics(false)
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.className = ''
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('the keyboard diagnostics panel', () => {
  it('stands fixed at the top and lets every tap through', () => {
    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })
    const panel = wrapper.find('.abele-keyboard-diagnostics').element as HTMLElement

    expect(panel.style.pointerEvents).toBe('none')
    expect(panel.style.position).toBe('fixed')
    expect(['0', '0px']).toContain(panel.style.top)
  })

  it('shows the sizes the page reports', () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })

    expect(wrapper.text()).toContain('inner')
    expect(wrapper.text()).toContain('844')
  })

  it('shows the keyboard height Obsidian writes as it changes', async () => {
    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })

    document.documentElement.style.setProperty('--keyboard-height', '336px')
    await tick()

    expect(wrapper.text()).toContain('--keyboard-height')
    expect(wrapper.text()).toContain('336px')
  })

  it('lists the keyboard events it has seen, with what they carried', async () => {
    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })

    const event = new Event('keyboardWillShow')
    Object.assign(event, { keyboardHeight: 291 })
    window.dispatchEvent(event)
    await tick()

    expect(wrapper.text()).toContain('keyboardWillShow')
    expect(wrapper.text()).toContain('291')
  })

  it('shows the body classes that say what kind of screen this is', async () => {
    document.body.className = 'is-mobile is-phone theme-dark keyboard-animating'
    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })
    await tick()

    expect(wrapper.text()).toContain('is-phone')
    expect(wrapper.text()).toContain('keyboard-animating')
    expect(wrapper.text()).not.toContain('theme-dark')
  })

  it('describes an open dialog and the field that has focus', async () => {
    const container = document.createElement('div')
    container.className = 'modal-container'
    const modal = document.createElement('div')
    modal.className = 'modal'
    const input = document.createElement('input')
    input.className = 'probe-field'
    modal.appendChild(input)
    container.appendChild(modal)
    document.body.appendChild(container)
    input.focus()

    wrapper = mount(KeyboardDiagnostics, { attachTo: document.body })
    await tick()

    expect(wrapper.text()).toContain('.modal-container')
    expect(wrapper.text()).toContain('focus')
    expect(wrapper.text()).toContain('input.probe-field')
  })
})

describe('turning the panel on and off', () => {
  it('puts one panel on the page and takes it away again', () => {
    setKeyboardDiagnostics(true)
    setKeyboardDiagnostics(true)
    expect(document.querySelectorAll('.abele-keyboard-diagnostics')).toHaveLength(1)

    setKeyboardDiagnostics(false)
    expect(document.querySelectorAll('.abele-keyboard-diagnostics')).toHaveLength(0)
  })

  it('is off unless asked for, and stays on the device it was turned on', () => {
    expect(DEFAULT_SETTINGS.keyboardDiagnostics).toBe(false)

    const entries = collectEntries({ ...DEFAULT_SETTINGS, keyboardDiagnostics: true })
    for (const entry of entries) {
      expect(JSON.stringify(entry.data)).not.toContain('keyboardDiagnostics')
    }
  })
})
