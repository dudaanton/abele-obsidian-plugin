import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Modal } from 'obsidian'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('native modal lifecycle', () => {
  it('does not treat being temporarily hidden or replaced by its parent as a user dismissal', () => {
    const close = vi.fn()
    const view = mount(ObsidianModal, { props: { title: 'A queued question', onClose: close } })
    view.unmount()
    expect(close).not.toHaveBeenCalled()
  })

  it('still emits close when the native dialog is dismissed by the user', () => {
    const open = vi.spyOn(Modal.prototype, 'open')
    const close = vi.fn()
    const view = mount(ObsidianModal, { props: { title: 'A queued question', onClose: close } })
    open.mock.contexts[0].close()
    expect(close).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
