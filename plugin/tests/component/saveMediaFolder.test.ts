import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SaveMediaModal from '@/components/SaveMediaModal.vue'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/http', async (original) => ({
  ...(await original<typeof import('@/helpers/http')>()),
  request: vi.fn(async () => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    arrayBuffer: new TextEncoder().encode('sample binary').buffer,
  })),
}))

afterEach(() => vi.restoreAllMocks())

describe('saving remote media into the same-folder attachment setting', () => {
  it('indexes root attachments and saves into the root rather than creating ./', async () => {
    const url = 'https://media.sample.invalid/sample.png'
    const app = useVault([{ path: 'sample-note.md', content: `![sample](${url})` }])
    Object.assign(app.vault, { getConfig: () => './' })
    const createFolder = vi
      .spyOn(app.vault, 'createFolder')
      .mockRejectedValue(new Error('Folder already exists.'))
    const wrapper = mount(SaveMediaModal, {
      shallow: true,
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    try {
      const state = (wrapper.vm as any).$.setupState
      await state.scan()
      expect(state.items).toHaveLength(1)
      await state.downloadItem(state.items[0])
      await flushPromises()
      expect(state.items[0].status).toBe('done')
      expect(state.items[0].savedPath).toMatch(/^sample-[^.]+\.png$/)
      expect(app.vault.getAbstractFileByPath(state.items[0].savedPath)).not.toBeNull()
      expect(createFolder).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })
})
