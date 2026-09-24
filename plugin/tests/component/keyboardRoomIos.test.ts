/**
 * A dialog and the on-screen keyboard as Obsidian's iPhone app reports it.
 *
 * 1.29.0 fitted the task's date dialog to the visual viewport, and on the owner's iPhone the
 * keyboard still covered it. Obsidian's app does not work that way on iOS: its own stylesheet
 * takes `--keyboard-height` off `100vh` for the workspace and the mobile toolbar, which only
 * makes sense if the page stays the height of the screen while the keyboard is up. The
 * variable is written by the native side of the app, which also raises `keyboardWillShow` and
 * `keyboardWillHide` on the window. So the viewport says nothing, and those two do.
 *
 * Here the visual viewport never moves, as there. The keyboard is told through the variable,
 * written on the root element the way the app writes it, or through the window event alone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import dayjs from 'dayjs'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { useVault } from '../helpers/testEnv'

const SCREEN = 844
const KEYBOARD = 336

class StillViewport extends EventTarget {
  height = SCREEN
  offsetTop = 0
  width = 390
}

let wrapper: VueWrapper | null = null
/** How tall the page is — the container follows it, as a fixed box on the whole page does. */
let page = SCREEN

const container = () => document.querySelector<HTMLElement>('.modal-container')
const timeField = () =>
  document.querySelector<HTMLInputElement>('.abele-datetime-picker__time input[type="text"]')
const fitted = () => container()?.classList.contains('abele-keyboard-room') ?? false
const roomHeight = () => container()?.style.getPropertyValue('--abele-room-height')

/** Past a MutationObserver's delivery and the timeouts the room re-measures on. */
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 400))
  await nextTick()
}

const setKeyboardVar = (px: number) => {
  document.documentElement.style.setProperty('--keyboard-height', `${px}px`)
}

const raise = (name: string, keyboardHeight?: number) => {
  const event = new Event(name)
  if (keyboardHeight !== undefined) Object.assign(event, { keyboardHeight })
  window.dispatchEvent(event)
}

const setPage = (height: number) => {
  page = height
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

beforeEach(() => {
  useVault([])
  Object.defineProperty(window, 'visualViewport', {
    value: new StillViewport(),
    configurable: true,
  })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  setPage(SCREEN)
  document.documentElement.style.removeProperty('--keyboard-height')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.classList.contains('modal-container') ? page : 0
    return {
      top: 0,
      bottom: height,
      left: 0,
      right: 390,
      width: 390,
      height,
      x: 0,
      y: 0,
    } as DOMRect
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const openDateDialog = () => {
  wrapper = mount(DateTimePickerModal, {
    props: { mode: 'event', initialDate: dayjs('2026-09-30') },
    attachTo: document.body,
  })
}

describe('a dialog under the iPhone keyboard', () => {
  it('stands above it when the app writes the keyboard height', async () => {
    openDateDialog()
    timeField()!.focus()

    setKeyboardVar(KEYBOARD)
    await settle()

    expect(fitted()).toBe(true)
    expect(roomHeight()).toBe(`${SCREEN - KEYBOARD}px`)
  })

  it('stands above it when only the window event says how tall it is', async () => {
    openDateDialog()
    timeField()!.focus()

    raise('keyboardWillShow', KEYBOARD)
    await settle()

    expect(fitted()).toBe(true)
    expect(roomHeight()).toBe(`${SCREEN - KEYBOARD}px`)
  })

  it('gives the room back when the keyboard goes', async () => {
    openDateDialog()
    timeField()!.focus()
    setKeyboardVar(KEYBOARD)
    raise('keyboardWillShow', KEYBOARD)
    await settle()

    setKeyboardVar(0)
    raise('keyboardWillHide')
    await settle()

    expect(fitted()).toBe(false)
  })

  it('does not take the keyboard off twice where the page has already shrunk for it', async () => {
    openDateDialog()
    timeField()!.focus()
    await settle()

    setPage(SCREEN - KEYBOARD)
    setKeyboardVar(KEYBOARD)
    window.dispatchEvent(new Event('resize'))
    await settle()

    expect(fitted()).toBe(false)
  })

  it('ignores a keyboard height left behind when none of its fields is being typed into', async () => {
    openDateDialog()

    setKeyboardVar(KEYBOARD)
    await settle()

    expect(fitted()).toBe(false)
  })

  it('lets go once the field loses focus, even if the height is never reset', async () => {
    openDateDialog()
    const field = timeField()!
    field.focus()
    setKeyboardVar(KEYBOARD)
    await settle()
    expect(fitted()).toBe(true)

    field.blur()
    await settle()

    expect(fitted()).toBe(false)
  })

  it('does the same for every dialog of the plugin, not only the date one', async () => {
    const Form = defineComponent({
      setup: () => () =>
        h(ObsidianModal, { title: 'Form' }, { default: () => h('input', { class: 'probe' }) }),
    })
    wrapper = mount(Form, { attachTo: document.body })
    await nextTick()
    document.querySelector<HTMLInputElement>('input.probe')!.focus()

    setKeyboardVar(KEYBOARD)
    await settle()

    expect(fitted()).toBe(true)
    expect(roomHeight()).toBe(`${SCREEN - KEYBOARD}px`)
  })
})
