import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ExternalFileRules from '@/components/settings/sync/ExternalFileRules.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { useVault } from '../helpers/testEnv'
import { externalActionsOf } from '@/sync/external/actionHost'
import { ExternalFileActions } from '@/sync/external/fileActions'
import { confirmOffload } from '@/sync/external/registerActions'
import { readRule } from '@/sync/external/rules'

vi.mock('@/sync/external/registerActions', () => ({
  confirmOffload: vi.fn(async () => false),
  externalStatus: (status: string) => status,
}))

it('uses ordinary setting rows and saves or applies nothing until the preview is confirmed', async () => {
  const app = useVault([{ path: 'Media/sample.bin', content: 'abc' }])
  const selected = vi
    .spyOn(TokenSettingsPort, 'getInstance')
    .mockReturnValue({ connectionId: 'sample' } as TokenSettingsPort)
  const evict = vi.fn(async () => ({ status: 'complete', reclaimedBytes: 3 }))
  externalActionsOf.set(app.vault, {
    actions: () =>
      new ExternalFileActions({
        inspect: async (path) => ({ path, size: 3, version: 'v', pinned: false, blocked: null }),
        evict,
      }),
    pin: vi.fn(),
    hydrate: vi.fn(),
  })
  const wrapper = mount(ExternalFileRules)
  expect(wrapper.findAll('.setting-item')).toHaveLength(6)
  expect(wrapper.findAll('input')).toHaveLength(4)
  await wrapper.findAll('input')[0].setValue('Media')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(confirmOffload).toHaveBeenCalled()
  expect(readRule(app as never, 'sample').folder).toBe('')
  expect(evict).not.toHaveBeenCalled()
  vi.mocked(confirmOffload).mockResolvedValueOnce(true)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(readRule(app as never, 'sample').folder).toBe('Media')
  expect(evict).toHaveBeenCalledOnce()
  wrapper.unmount()
  selected.mockRestore()
  externalActionsOf.delete(app.vault)
})
