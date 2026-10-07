import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { Modal } from 'obsidian'
import SyncLogModal from '@/components/sync/SyncLogModal.vue'
import DeletedFilesModal from '@/components/sync/DeletedFilesModal.vue'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
it.each([SyncLogModal, DeletedFilesModal])(
  'forwards native sheet dismissal once, including while trash is loading',
  async (Sheet) => {
    let finish: (value: never[]) => void = () => {}
    const trash = new Promise<never[]>((resolve) => {
      finish = resolve
    })
    vi.spyOn(SyncService, 'getInstance').mockReturnValue({
      log: ref([]),
      client: () => ({ trash: () => trash }),
    } as never)
    const opened = vi.spyOn(Modal.prototype, 'open'),
      dismissed = vi.fn(),
      showing = ref(true)
    const Parent = defineComponent({
      setup: () => () =>
        showing.value
          ? h(Sheet, {
              onClose: () => {
                dismissed()
                showing.value = false
              },
            })
          : null,
    })
    const screen = mount(Parent)
    try {
      const native = opened.mock.contexts[0]
      expect(native.isOpen).toBe(true)
      native.close()
      await flushPromises()
      expect(dismissed).toHaveBeenCalledTimes(1)
      expect(native.isOpen).toBe(false)
      expect(screen.findComponent(Sheet).exists()).toBe(false)
      finish([])
      await flushPromises()
      expect(dismissed).toHaveBeenCalledTimes(1)
      expect(screen.findComponent(Sheet).exists()).toBe(false)
    } finally {
      screen.unmount()
      finish([])
    }
  }
)
