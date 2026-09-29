/**
 * The dialog shell and a phone's keyboard, for a form that runs longer than the room the
 * keyboard leaves.
 *
 * A generated form has more fields than fit above a simulated phone keyboard. Its note field
 * uses Obsidian's editor with a nested scroller. The dialog and nested scroller must leave the
 * active line and action buttons visible above the keyboard and editing toolbar as text grows.
 *
 * happy-dom lays nothing out, so the geometry is described: a 390×844 screen, the keyboard as
 * Obsidian's iPhone app reports it (`--keyboard-height`, the page not shrinking), a form taller
 * than what is left above it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { ShellModal } from '@/modal/ShellModal'
import { useVault } from '../helpers/testEnv'

const SCREEN = 844
const KEYBOARD = 336
const TOOLBAR = 44
/** Where each part stands, by its class: top and bottom. */
const GEOMETRY: Record<string, [number, number]> = {
  'modal-container': [0, SCREEN],
  modal: [60, SCREEN],
  'abele-modal__body': [120, SCREEN - 70],
  'cm-scroller': [560, 760],
  'mobile-toolbar': [SCREEN - KEYBOARD - TOOLBAR, SCREEN - KEYBOARD],
  'caret-line': [700, 724],
}

class StillViewport extends EventTarget {
  height = SCREEN
  offsetTop = 0
  width = 390
}

let wrapper: VueWrapper | null = null

const container = () => document.querySelector<HTMLElement>('.modal-container')!
const body = () => document.querySelector<HTMLElement>('.abele-modal__body')!

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 400))
  await nextTick()
}

beforeEach(() => {
  useVault([])
  document.body.classList.add('is-mobile', 'is-phone')
  Object.defineProperty(window, 'visualViewport', {
    value: new StillViewport(),
    configurable: true,
  })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: SCREEN, configurable: true })
  document.documentElement.style.removeProperty('--keyboard-height')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const key = Object.keys(GEOMETRY).find((cls) => this.classList.contains(cls))
    const [top, bottom] = key ? GEOMETRY[key] : [0, 0]
    return {
      top,
      bottom,
      left: 0,
      right: 390,
      width: 390,
      height: bottom - top,
      x: 0,
      y: top,
    } as DOMRect
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.classList.remove('is-mobile', 'is-phone')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** A form whose last field is a note field: an editor box that scrolls inside itself. */
const LongForm = defineComponent({
  setup: () => () =>
    h(
      ObsidianModal,
      { title: 'Form' },
      {
        default: () => [
          ...Array.from({ length: 10 }, (_, i) => h('input', { class: `field-${i}` })),
          h('div', { class: 'cm-editor' }, [
            h('div', { class: 'cm-scroller', style: 'overflow-y: auto' }, [
              h('div', { class: 'cm-content', contenteditable: 'true' }, [
                h('div', { class: 'cm-line' }, 'one'),
                h('div', { class: 'cm-line caret-line' }, 'two'),
              ]),
            ]),
          ]),
        ],
        footer: () => h('button', { class: 'run' }, 'Run'),
      }
    ),
})

const typeIntoNote = async () => {
  wrapper = mount(LongForm, { attachTo: document.body })
  await nextTick()
  const editor = document.querySelector<HTMLElement>('.cm-content')!
  editor.focus()
  const line = document.querySelector('.caret-line')!.firstChild!
  const range = document.createRange()
  range.setStart(line, 3)
  range.collapse(true)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.documentElement.style.setProperty('--keyboard-height', `${KEYBOARD}px`)
  await settle()
  return editor
}

describe('a long form under the phone keyboard', () => {
  it('scrolls its body, never the note field’s own box', async () => {
    await typeIntoNote()

    expect(
      document.querySelector('.cm-scroller')!.classList.contains('abele-keyboard-scroller')
    ).toBe(false)
  })

  it('is fitted into the room the keyboard leaves, its buttons with it', async () => {
    await typeIntoNote()

    expect(container().classList.contains('abele-keyboard-room')).toBe(true)
    expect(container().style.getPropertyValue('--abele-room-height')).toBe(`${SCREEN - KEYBOARD}px`)
  })

  it('counts Obsidian’s editing toolbar over the keyboard as covered', async () => {
    const toolbar = document.body.createDiv({ cls: 'mobile-toolbar' })
    await typeIntoNote()

    expect(container().style.getPropertyValue('--abele-room-height')).toBe(
      `${SCREEN - KEYBOARD - TOOLBAR}px`
    )
    toolbar.remove()
  })

  describe('Obsidian’s toolbar landing after the keyboard has settled', () => {
    const LANDED = GEOMETRY['mobile-toolbar']
    /** Still on its way up from under the keyboard. */
    const SLIDING: [number, number] = [SCREEN - 60, SCREEN - 15]
    afterEach(() => {
      GEOMETRY['mobile-toolbar'] = LANDED
    })

    const typeWhileSliding = async () => {
      document.body.createDiv({ cls: 'mobile-toolbar' })
      GEOMETRY['mobile-toolbar'] = SLIDING
      await typeIntoNote()
      // Fitted to the keyboard alone: the toolbar is still under it.
      expect(container().style.getPropertyValue('--abele-room-height')).toBe(
        `${SCREEN - KEYBOARD}px`
      )
      GEOMETRY['mobile-toolbar'] = LANDED
    }

    it('is fitted to the toolbar when its slide ends', async () => {
      await typeWhileSliding()

      document
        .querySelector('.mobile-toolbar')!
        .dispatchEvent(new Event('transitionend', { bubbles: true }))
      await nextTick()

      expect(container().style.getPropertyValue('--abele-room-height')).toBe(
        `${SCREEN - KEYBOARD - TOOLBAR}px`
      )
    })

    it('is fitted to the toolbar once it stands still, with no event to say so', async () => {
      await typeWhileSliding()

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(container().style.getPropertyValue('--abele-room-height')).toBe(
        `${SCREEN - KEYBOARD - TOOLBAR}px`
      )
    })
  })

  it('keeps the line being typed above the keyboard as the text grows', async () => {
    const editor = await typeIntoNote()
    body().scrollTop = 0

    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await settle()

    // The caret's line, 724 down, is brought up to 12 px above the keyboard's top.
    expect(body().scrollTop).toBe(724 - (SCREEN - KEYBOARD - 12))
  })
})

describe('a long form whose buttons stand under its body', () => {
  it('keeps the line being typed in what the body shows, not behind the buttons', async () => {
    const was = GEOMETRY['abele-modal__body']
    // The body ends where the pinned row of buttons starts, above the keyboard's top.
    GEOMETRY['abele-modal__body'] = [120, 400]
    try {
      const editor = await typeIntoNote()
      body().scrollTop = 0
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      await settle()

      expect(body().scrollTop).toBe(724 - (400 - 12))
    } finally {
      GEOMETRY['abele-modal__body'] = was
    }
  })
})

describe('a dialog built without Vue', () => {
  it('has the same title, body that scrolls and pinned row of buttons', () => {
    const modal = new ShellModal({} as never, { title: 'New script', footer: true })
    const run = vi.fn()
    modal.addButton('Create', run, { cta: true })
    modal.open()

    expect(modal.modalEl.classList.contains('abele-modal')).toBe(true)
    expect(modal.modalEl.classList.contains('abele-modal_footed')).toBe(true)
    expect(modal.bodyEl.parentElement).toBe(modal.contentEl)
    const button = modal.footerEl!.querySelector('button')!
    expect(button.classList.contains('mod-cta')).toBe(true)
    button.click()
    expect(run).toHaveBeenCalled()
    modal.close()
  })

  it('keeps a field of its own above the keyboard like every other dialog', async () => {
    const modal = new ShellModal({} as never, { title: 'New snippet', footer: true })
    const input = modal.bodyEl.appendChild(document.createElement('input'))
    modal.open()
    input.focus()
    document.documentElement.style.setProperty('--keyboard-height', `${KEYBOARD}px`)
    await settle()

    const box = container()
    expect(box.classList.contains('abele-keyboard-room')).toBe(true)

    modal.close()
    await settle()
    expect(box.classList.contains('abele-keyboard-room')).toBe(false)
  })
})
