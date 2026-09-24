/**
 * The task's date dialog and the on-screen keyboard.
 *
 * On a phone the keyboard that came up for the time field covered the lower half of the
 * dialog — the field itself, the preset times and the buttons — and nothing could be scrolled
 * to bring them back. The dialog now stands in the part of the screen the keyboard leaves, and
 * the field being typed into is scrolled into sight whenever that part changes.
 *
 * happy-dom lays nothing out, so the room is described to it: a visual viewport that shrinks
 * as a keyboard would make it, and a container the size of the screen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import dayjs from 'dayjs'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import { useVault } from '../helpers/testEnv'

const SCREEN = 844
const KEYBOARD = 336

class FakeViewport extends EventTarget {
  height = SCREEN
  offsetTop = 0
  width = 390
}

let viewport: FakeViewport
let wrapper: VueWrapper | null = null
let scrolled: Element[] = []

const container = () => document.querySelector<HTMLElement>('.modal-container')
const timeField = () =>
  document.querySelector<HTMLInputElement>('.abele-datetime-picker__time input[type="text"]')

const keyboard = (up: boolean) => {
  viewport.height = up ? SCREEN - KEYBOARD : SCREEN
  viewport.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  useVault([])
  viewport = new FakeViewport()
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  // The container covers the whole screen, as Obsidian's does.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.classList.contains('modal-container') ? SCREEN : 0
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
  scrolled = []
  HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
    scrolled.push(this)
  })
  wrapper = mount(DateTimePickerModal, {
    props: { mode: 'event', initialDate: dayjs('2026-09-30') },
    attachTo: document.body,
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('the date dialog with a keyboard up', () => {
  it('leaves the container as Obsidian made it while nothing covers the screen', () => {
    expect(container()?.classList.contains('abele-keyboard-room')).toBe(false)
  })

  it('stands in the part of the screen the keyboard leaves', () => {
    keyboard(true)

    expect(container()?.classList.contains('abele-keyboard-room')).toBe(true)
    expect(container()?.style.getPropertyValue('--abele-room-top')).toBe('0px')
    expect(container()?.style.getPropertyValue('--abele-room-height')).toBe(
      `${SCREEN - KEYBOARD}px`
    )
  })

  it('gives the room back when the keyboard goes', () => {
    keyboard(true)
    keyboard(false)

    expect(container()?.classList.contains('abele-keyboard-room')).toBe(false)
    expect(container()?.style.getPropertyValue('--abele-room-height')).toBe('')
  })

  it('brings the time field into sight when the keyboard comes up for it', () => {
    const field = timeField()!
    field.focus()
    scrolled = []

    keyboard(true)

    expect(scrolled).toContain(field)
  })

  it('brings a field into sight as soon as it takes focus', async () => {
    const field = timeField()!
    field.focus()
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    await nextTick()

    expect(scrolled).toContain(field)
  })

  it('stops following the keyboard once closed', () => {
    const el = container()!
    keyboard(true)
    wrapper?.unmount()
    wrapper = null

    expect(el.classList.contains('abele-keyboard-room')).toBe(false)
    keyboard(true)
    expect(el.classList.contains('abele-keyboard-room')).toBe(false)
  })
})
