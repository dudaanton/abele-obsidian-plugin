import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { expect, it } from 'vitest'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { useVault } from '../helpers/testEnv'

it('addresses the current confirmation body and shared footer in the phone probe', () => {
  const source = readFileSync('tests/e2e/syncPhone.e2e.test.ts', 'utf8')
  expect(source).toContain("document.querySelector('.abele-confirm__message')")
  expect(source).toContain("confirm.querySelectorAll('.abele-modal__footer button')")
  expect(source).not.toContain("document.querySelector('.abele-confirm')")
  expect(source).not.toContain('.abele-confirm__actions')
})

it('finds both restore actions in the real modal footer and Cancel leaves the sheet underneath', async () => {
  useVault([])
  const shown = ref(true)
  const sheet = document.createElement('div')
  sheet.className = 'abele-version-history'
  document.body.appendChild(sheet)
  const screen = mount(
    defineComponent({
      setup: () => () =>
        shown.value
          ? h(ConfirmModal, {
              title: 'Restore this version?',
              message: 'Restore the selected note version?',
              confirmText: 'Restore',
              onClose: () => {
                shown.value = false
              },
            })
          : null,
    }),
    { attachTo: document.body }
  )
  try {
    await nextTick()
    const message = document.querySelector('.abele-confirm__message')!
    expect(message.closest('.abele-modal__body')).not.toBeNull()
    const confirm = message.closest('.modal')!
    const buttons = [...confirm.querySelectorAll<HTMLButtonElement>('.abele-modal__footer button')]
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Cancel', 'Restore'])
    expect(buttons.every((button) => !button.disabled)).toBe(true)
    buttons[0].click()
    await nextTick()
    expect(document.querySelector('.abele-confirm__message')).toBeNull()
    expect(document.querySelector('.abele-version-history')).toBe(sheet)
  } finally {
    screen.unmount()
    sheet.remove()
  }
})
