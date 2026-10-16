/**
 * An awaited kit dialog answers once its shell has really closed — after Obsidian's close
 * animation has run `onClose` — whatever the host app reports about the dialog being open.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Modal } from 'obsidian'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  vi.restoreAllMocks()
  closeComponentDialogs()
  document.body.replaceChildren()
})

it('answers only after the closing animation, even where the host has no isOpen', async () => {
  // A host that animates its close and keeps no `isOpen`, as the phone app does.
  let finish: (() => void) | null = null
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    document.body.appendChild(this.containerEl)
  })
  vi.spyOn(Modal.prototype, 'close').mockImplementation(function (this: Modal) {
    finish = () => {
      this.containerEl.remove()
      this.onClose()
    }
  })
  let answered: boolean | undefined
  void confirmDialog({ title: 'Delete?', message: 'Sample' }).then((yes) => (answered = yes))
  ;[...document.querySelectorAll<HTMLButtonElement>('.modal button')]
    .find((b) => b.textContent?.trim() === 'Delete')!
    .click()
  await flushPromises()
  expect(answered).toBeUndefined()
  expect(document.querySelector('.modal')).not.toBeNull()
  finish!()
  await flushPromises()
  expect(answered).toBe(true)
})
