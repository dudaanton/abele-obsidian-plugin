import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { isReactive } from 'vue'
import { Modal } from 'obsidian'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('native modal lifecycle', () => {
  it('keeps the native modal and host application outside deep Vue reactivity', () => {
    const open = vi.spyOn(Modal.prototype, 'open')
    const view = mount(ObsidianModal, { props: { title: 'Sample settings' } })
    try {
      expect(isReactive(open.mock.contexts[0])).toBe(false)
      expect(isReactive(open.mock.contexts[0].app)).toBe(false)
    } finally {
      view.unmount()
    }
  })
  it('updates its native title when the conversation title changes', async () => {
    const title = vi.spyOn(Modal.prototype, 'setTitle')
    const view = mount(ObsidianModal, { props: { title: 'Sample chat' } })
    try {
      await view.setProps({ title: 'Parser review' })
      expect(title).toHaveBeenLastCalledWith('Parser review')
    } finally {
      view.unmount()
    }
  })
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
