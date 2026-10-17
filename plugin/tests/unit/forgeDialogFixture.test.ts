import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Modal } from 'obsidian'
import { dialogNames, openDialog } from '@/testing/openDialog'
import { useVault } from '../helpers/testEnv'
it('opens the real native PR dialog for phone and desktop probes without a provider write', async () => {
  useVault([])
  expect(dialogNames()).toContain('native-pr-create')
  const opened: Modal[] = []
  const open = Modal.prototype.open
  const spy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    opened.push(this)
    open.call(this)
  })
  try {
    openDialog('native-pr-create')
    await flushPromises()
    expect(opened[0]?.contentEl.textContent).toContain('Draft creation is not available')
    expect(opened[0]?.contentEl.querySelector('[aria-label="Open as a draft"]')).toBeNull()
  } finally {
    opened[0]?.close()
    await flushPromises()
    spy.mockRestore()
  }
})
