/** Keyboard handling must not move an action between the press and its click. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Card from '@/components/obsidian/Card.vue'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | null = null
let scroll: ReturnType<typeof vi.fn>

beforeEach(() => {
  useVault([])
  vi.useFakeTimers()
  scroll = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const top = this.classList.contains('modal-container') ? 0 : 600
    const height = this.classList.contains('modal-container') ? 844 : 80
    return { top, bottom: top + height, left: 0, right: 390, width: 390, height } as DOMRect
  })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
  Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty('--keyboard-height')
  document.body.classList.remove('is-mobile', 'is-phone')
  document.body.replaceChildren()
})

const open = async () => {
  const selected = vi.fn()
  const Form = defineComponent({
    setup: () => () =>
      h(ObsidianModal, { title: 'Sample history', size: 'tall' }, () => [
        h('input', { class: 'search', type: 'text' }),
        h('div', { class: 'list', style: 'overflow-y: auto' }, [
          h(Card, { title: 'Sample chat', clickable: true, onClick: selected }),
          h('button', { class: 'action' }, 'Open'),
          h('a', { href: '#sample', class: 'link' }, 'Sample link'),
          h('div', { tabindex: 0, role: 'button', class: 'row' }, 'Sample row'),
          ...[
            'checkbox',
            'radio',
            'button',
            'submit',
            'reset',
            'image',
            'range',
            'color',
            'file',
          ].map((type) => h('input', { type })),
          h('select', {}, [h('option', {}, 'Sample option')]),
        ]),
      ]),
  })
  wrapper = mount(Form, { attachTo: document.body })
  await nextTick()
  return selected
}

const settle = async () => {
  await nextTick()
  await vi.advanceTimersByTimeAsync(400)
}

for (const layout of ['phone', 'desktop', 'tablet'] as const) {
  describe(`dialog actions on ${layout}`, () => {
    beforeEach(() => {
      if (layout !== 'desktop') document.body.classList.add('is-mobile')
      if (layout === 'phone') document.body.classList.add('is-phone')
    })

    it.each([false, true])(
      'does not centre a card on the first press (search focused: %s)',
      async (searchFocused) => {
        const selected = await open()
        if (searchFocused) {
          document.querySelector<HTMLInputElement>('.search')!.focus()
          document.documentElement.style.setProperty('--keyboard-height', '336px')
          await settle()
        }
        scroll.mockClear()
        const list = document.querySelector<HTMLElement>('.list')!
        const before = list.scrollTop
        const card = document.querySelector<HTMLElement>('.abele-card')!
        card.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        card.focus()
        // Focus runs before click. Moving the card here can cancel a touch click.
        expect(scroll).not.toHaveBeenCalled()
        expect(list.scrollTop).toBe(before)
        card.click()
        expect(selected).toHaveBeenCalledTimes(1)
        await settle()
        window.dispatchEvent(new Event('resize'))
        expect(scroll).not.toHaveBeenCalled()
        expect(list.scrollTop).toBe(before)
      }
    )

    it('does not reveal buttons, links, list rows or action-only controls', async () => {
      await open()
      const list = document.querySelector<HTMLElement>('.list')!
      for (const control of list.querySelectorAll<HTMLElement>('button, a, [tabindex], input')) {
        scroll.mockClear()
        const before = list.scrollTop
        control.focus()
        await settle()
        expect(scroll).not.toHaveBeenCalled()
        expect(list.scrollTop).toBe(before)
      }
    })
  })
}

for (const layout of ['phone', 'tablet'] as const) {
  describe(`native select fields on a ${layout}`, () => {
    beforeEach(() => {
      document.body.classList.add('is-mobile')
      if (layout === 'phone') document.body.classList.add('is-phone')
    })

    it.each(['variable', 'event'] as const)(
      'never reveals the select or counts a keyboard height reported by %s',
      async (signal) => {
        await open()
        const select = document.querySelector<HTMLSelectElement>('select')!
        const list = document.querySelector<HTMLElement>('.list')!
        const before = list.scrollTop
        select.focus()
        expect(scroll).not.toHaveBeenCalled()
        expect(list.scrollTop).toBe(before)
        if (signal === 'variable') {
          document.documentElement.style.setProperty('--keyboard-height', '336px')
        } else {
          const event = new Event('keyboardWillShow')
          Object.assign(event, { keyboardHeight: 336 })
          window.dispatchEvent(event)
        }
        await settle()

        window.dispatchEvent(new Event('resize'))
        expect(scroll).not.toHaveBeenCalled()
        expect(list.scrollTop).toBe(before)
        const container = document.querySelector<HTMLElement>('.modal-container')!
        expect(container.classList.contains('abele-keyboard-room')).toBe(false)
        expect(container.classList.contains('abele-keyboard-lift')).toBe(false)
        expect(container.style.getPropertyValue('--abele-room-height')).toBe('')

        // A height left behind after closing the popover must not keep the dialog fitted.
        select.blur()
        await settle()
        expect(container.classList.contains('abele-keyboard-room')).toBe(false)
      }
    )
  })
}

it('still centres a text field and fits the dialog above its keyboard on a phone', async () => {
  document.body.classList.add('is-mobile', 'is-phone')
  await open()
  const search = document.querySelector<HTMLInputElement>('.search')!
  search.focus()
  document.documentElement.style.setProperty('--keyboard-height', '336px')
  await settle()
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(scroll.mock.contexts).toContain(search)
  expect(
    document.querySelector('.modal-container')?.classList.contains('abele-keyboard-room')
  ).toBe(true)
})
