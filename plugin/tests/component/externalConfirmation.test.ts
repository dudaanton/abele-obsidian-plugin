import { afterEach, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
})

it('uses the shared tall shell and keeps every preview row visible as text; cancel is not consent', async () => {
  useVault([])
  const answer = confirmDialog({
    title: 'Keep only on the server',
    size: 'tall',
    message: '2 files\nMedia/sample.bin · 20 bytes\nMedia/other.bin · 30 bytes',
    confirmText: 'Keep only on the server',
  })
  await flushPromises()
  const modal = document.querySelector('.modal.abele-modal.mod-lg')!
  expect(modal).not.toBeNull()
  const rows = modal.querySelectorAll('.abele-confirm__message')
  expect([...rows].map((row) => row.textContent)).toEqual([
    '2 files',
    'Media/sample.bin · 20 bytes',
    'Media/other.bin · 30 bytes',
  ])
  const cancel = [...modal.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Cancel'
  )!
  cancel.click()
  expect(await answer).toBe(false)
  expect(document.querySelector('.modal.abele-modal.mod-lg')).toBeNull()
})
