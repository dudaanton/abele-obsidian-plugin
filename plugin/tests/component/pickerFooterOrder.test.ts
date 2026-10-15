/**
 * The date and recurrence dialogs order their buttons as Obsidian does: the one that takes the
 * value off stands apart at the start, then Cancel, and the answer, Confirm, last.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import RecurrencePickerModal from '@/components/RecurrencePickerModal.vue'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | null = null
beforeEach(() => useVault([]))
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
})

const footer = () => {
  const row = document.querySelector<HTMLElement>('.abele-modal__footer')!
  return [...row.querySelectorAll<HTMLButtonElement>('button')]
}

describe('a picker dialog footer', () => {
  it.each([
    [
      'date',
      () =>
        mount(DateTimePickerModal, {
          props: { mode: 'event', initialDate: dayjs('2026-09-30') },
          attachTo: document.body,
        }),
    ],
    ['recurrence', () => mount(RecurrencePickerModal, { attachTo: document.body })],
  ])('the %s dialog reads Clear apart, Cancel, Confirm', (_, open) => {
    wrapper = open()
    const buttons = footer()
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Clear', 'Cancel', 'Confirm'])
    expect(buttons[0].classList.contains('abele-modal__apart')).toBe(true)
    expect(buttons.slice(1).some((b) => b.classList.contains('abele-modal__apart'))).toBe(false)
  })
})
