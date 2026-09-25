/**
 * A dialog on an iPad with the on-screen keyboard up, and the iPhone's behaviour kept as it is.
 *
 * The phone's fix (a dialog taller than the room pinned to the top of the screen, the field
 * scrolled to the middle of its box, every measurement letting go and starting again) worked
 * on the owner's iPhone. On his iPad the same dialog "scrolled very strangely and the field
 * still ended up under the keyboard": Obsidian's tablet layout stands a dialog in the middle of
 * the screen, and the keyboard covers less of it or none of it. On a tablet the dialog is now
 * moved up only by what the keyboard covers of it, the field is scrolled only when the
 * keyboard covers it, and a measurement that finds nothing new changes nothing.
 *
 * The layout here is drawn by hand: happy-dom computes none. Rects follow what the composable
 * writes — the lift on the container, the scroll position of the box.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { useVault } from '../helpers/testEnv'
import { liftFor, revealDelta, KEYBOARD_GAP } from '@/composables/keyboardLift'

class StillViewport extends EventTarget {
  height: number
  offsetTop = 0
  width: number
  constructor(width: number, height: number) {
    super()
    this.width = width
    this.height = height
  }
}

let wrapper: VueWrapper | null = null
let screen = { width: 1024, height: 768 }
/** The dialog where Obsidian stands it: its height, centred on the screen. */
let dialogHeight = 500
/** Where the field sits inside the list, from the list's top. */
let fieldOffset = 300

const LIST_TOP = 60

const container = () => document.querySelector<HTMLElement>('.modal-container')!
const list = () => document.querySelector<HTMLElement>('.list')!
const field = () => document.querySelector<HTMLInputElement>('input.field')!
const liftPx = () => parseFloat(container().style.getPropertyValue('--abele-keyboard-lift')) || 0
const lifted = () => container().classList.contains('abele-keyboard-lift')

const rect = (top: number, height: number, width = screen.width) =>
  ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top }) as DOMRect

const layout = () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.classList.contains('modal-container')) return rect(0, screen.height)
    const box = this.closest('.modal-container') as HTMLElement | null
    const lift = box?.classList.contains('abele-keyboard-lift')
      ? parseFloat(box.style.getPropertyValue('--abele-keyboard-lift')) || 0
      : 0
    const dialogTop = (screen.height - dialogHeight) / 2 - lift
    if (this.classList.contains('modal')) return rect(dialogTop, dialogHeight, 600)
    if (this.classList.contains('list'))
      return rect(dialogTop + LIST_TOP, dialogHeight - LIST_TOP, 600)
    if (this.classList.contains('field')) {
      const scrolled = this.closest<HTMLElement>('.list')?.scrollTop ?? 0
      return rect(dialogTop + LIST_TOP + fieldOffset - scrolled, 40, 600)
    }
    return rect(0, 0, 0)
  })
}

const setScreen = (width: number, height: number) => {
  screen = { width, height }
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
  Object.defineProperty(window, 'visualViewport', {
    value: new StillViewport(width, height),
    configurable: true,
  })
}

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 400))
  await nextTick()
}

const keyboard = async (px: number) => {
  document.documentElement.style.setProperty('--keyboard-height', `${px}px`)
  const event = new Event(px > 0 ? 'keyboardWillShow' : 'keyboardWillHide')
  if (px > 0) Object.assign(event, { keyboardHeight: px })
  window.dispatchEvent(event)
  await settle()
}

const openDialog = async () => {
  const Form = defineComponent({
    setup: () => () =>
      h(ObsidianModal, { title: 'Form' }, () =>
        h('div', { class: 'list', style: 'overflow-y: auto' }, [h('input', { class: 'field' })])
      ),
  })
  wrapper = mount(Form, { attachTo: document.body })
  await nextTick()
  field().focus()
  await settle()
}

let scrolledIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  useVault([])
  document.body.classList.add('is-mobile')
  dialogHeight = 500
  fieldOffset = 300
  document.documentElement.style.removeProperty('--keyboard-height')
  scrolledIntoView = vi.fn()
  HTMLElement.prototype.scrollIntoView =
    scrolledIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.classList.remove('is-mobile', 'is-tablet', 'is-phone')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('the arithmetic', () => {
  it('moves a dialog up only by what is covered, and no higher than the ceiling', () => {
    expect(liftFor({ top: 100, bottom: 600 }, 12, 700)).toBeNull()
    expect(liftFor({ top: 340, bottom: 840 }, 12, 768)).toEqual({ lift: 72, cover: 0 })
    expect(liftFor({ top: 134, bottom: 634 }, 12, 358)).toEqual({ lift: 122, cover: 154 })
  })

  it('scrolls a field only when it is out of the band', () => {
    expect(revealDelta({ top: 200, bottom: 240 }, 12, 358)).toBe(0)
    expect(revealDelta({ top: 400, bottom: 440 }, 12, 358)).toBe(82)
    expect(revealDelta({ top: 0, bottom: 40 }, 12, 358)).toBe(-12)
  })
})

describe('a dialog on an iPad, keyboard up', () => {
  beforeEach(() => {
    document.body.classList.add('is-tablet')
    setScreen(1024, 768)
    layout()
  })

  it('stays where it is under a hardware keyboard, whose bar covers none of it', async () => {
    await openDialog()
    await keyboard(55)

    expect(lifted()).toBe(false)
    expect(container().classList.contains('abele-keyboard-room')).toBe(false)
    expect(container().classList.contains('abele-keyboard-cover')).toBe(false)
    expect(list().scrollTop).toBe(0)
    expect(scrolledIntoView).not.toHaveBeenCalled()
  })

  it('moves up only as far as the keyboard covers it, where it then fits', async () => {
    setScreen(820, 1180)
    await openDialog()
    await keyboard(400)

    // Centred at 340..840; the keyboard starts at 780, the gap above it at 768.
    expect(liftPx()).toBe(840 - (1180 - 400 - KEYBOARD_GAP))
    expect(document.querySelector('.abele-keyboard-scroller')).toBeNull()
    // Not pinned to the top, not fitted into a room: the phone's classes are not used.
    expect(container().classList.contains('abele-keyboard-cover')).toBe(false)
    expect(container().classList.contains('abele-keyboard-room')).toBe(false)
    const f = field().getBoundingClientRect()
    expect(f.bottom).toBeLessThanOrEqual(1180 - 400)
    expect(scrolledIntoView).not.toHaveBeenCalled()
  })

  it('keeps its size in landscape, and the field it covers is scrolled just above the keyboard', async () => {
    await openDialog()
    await keyboard(398)

    // Centred at 134..634, moved up to the top of the screen and no further.
    expect(liftPx()).toBe(134 - KEYBOARD_GAP)
    const keyboardTop = 768 - 398
    expect(list().classList.contains('abele-keyboard-scroller')).toBe(true)
    expect(list().style.getPropertyValue('--abele-keyboard-cover')).toBe(
      `${634 - (134 - KEYBOARD_GAP) - (keyboardTop - KEYBOARD_GAP)}px`
    )
    const f = field().getBoundingClientRect()
    expect(f.bottom).toBeLessThanOrEqual(keyboardTop - KEYBOARD_GAP + 0.5)
    expect(f.top).toBeGreaterThanOrEqual(KEYBOARD_GAP)
    expect(scrolledIntoView).not.toHaveBeenCalled()
  })

  it('does not jump when the keyboard is measured again and again', async () => {
    await openDialog()
    await keyboard(398)
    const lift = liftPx()
    const scroll = list().scrollTop
    const changes: string[] = []
    const watch = new MutationObserver((records) => {
      for (const r of records)
        changes.push(`${(r.target as HTMLElement).className} ${r.attributeName}`)
    })
    watch.observe(container(), { attributes: true, subtree: true })

    for (let i = 0; i < 5; i++) {
      window.visualViewport!.dispatchEvent(new Event('scroll'))
      window.visualViewport!.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
      await keyboard(398)
    }
    watch.disconnect()

    expect(liftPx()).toBe(lift)
    expect(list().scrollTop).toBe(scroll)
    expect(changes).toEqual([])
  })

  it('goes back where it was once the keyboard goes', async () => {
    await openDialog()
    await keyboard(398)
    expect(lifted()).toBe(true)

    await keyboard(0)
    field().blur()
    await settle()

    expect(lifted()).toBe(false)
    expect(container().style.getPropertyValue('--abele-keyboard-lift')).toBe('')
    expect(list().classList.contains('abele-keyboard-scroller')).toBe(false)
  })
})

describe('the same dialog on an iPhone, as it was', () => {
  const SCREEN = 844
  const KEYBOARD = 336
  const DIALOG = 700

  beforeEach(() => {
    document.body.classList.add('is-phone')
    setScreen(390, SCREEN)
    dialogHeight = DIALOG
    // The phone sheet stands on the bottom of the screen until it is pinned to the room's top.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains('modal-container')) return rect(0, SCREEN, 390)
      const pinned = this.closest('.modal-container')?.classList.contains('abele-keyboard-cover')
      const top = pinned ? 0 : SCREEN - DIALOG
      if (this.classList.contains('modal')) return rect(top, DIALOG, 390)
      if (this.classList.contains('list')) return rect(top + LIST_TOP, DIALOG - LIST_TOP, 390)
      return rect(0, 0, 0)
    })
  })

  it('is pinned to the top, keeps its size, scrolls what is covered and centres the field', async () => {
    await openDialog()
    await keyboard(KEYBOARD)

    expect(container().classList.contains('abele-keyboard-cover')).toBe(true)
    expect(container().style.getPropertyValue('--abele-room-top')).toBe('0px')
    expect(container().style.getPropertyValue('--abele-room-height')).toBe(`${SCREEN - KEYBOARD}px`)
    expect(lifted()).toBe(false)
    expect(list().classList.contains('abele-keyboard-scroller')).toBe(true)
    expect(list().style.getPropertyValue('--abele-keyboard-cover')).toBe(
      `${DIALOG - (SCREEN - KEYBOARD)}px`
    )
    expect(scrolledIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('fits a dialog shorter than the room into it, as before', async () => {
    dialogHeight = 300
    vi.restoreAllMocks()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains('modal-container')) return rect(0, SCREEN, 390)
      if (this.classList.contains('modal')) return rect(SCREEN - 300, 300, 390)
      return rect(0, 0, 0)
    })
    HTMLElement.prototype.scrollIntoView =
      scrolledIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView
    await openDialog()
    await keyboard(KEYBOARD)

    expect(container().classList.contains('abele-keyboard-room')).toBe(true)
    expect(container().style.getPropertyValue('--abele-room-height')).toBe(`${SCREEN - KEYBOARD}px`)
    expect(lifted()).toBe(false)
  })
})
