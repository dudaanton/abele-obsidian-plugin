import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OwnerFolderSharingModal from '@/components/sync/OwnerFolderSharingModal.vue'
describe('owner folder sharing UI', () => {
  it('shows a truthful disabled fence and cannot call any management port', async () => {
    const flow = { review: vi.fn(), confirm: vi.fn(), clear: vi.fn() }
    const w = mount(OwnerFolderSharingModal, {
      props: { flow: flow as any, enabled: false },
      global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
    })
    expect(w.text()).toContain('not active')
    expect(w.find('input').attributes()).toHaveProperty('disabled')
    await w.findAll('button')[0].trigger('click')
    expect(flow.review).not.toHaveBeenCalled()
    w.unmount()
  })
  it.each(['Folder access', 'Folder path', 'Share name'])(
    'requires another preview after changing %s',
    async (field) => {
      const flow = {
        review: vi.fn(async () => ({
          prefix: 'Sample folder/',
          generation: '1',
          complete: true,
          files: [],
        })),
        confirm: vi.fn(),
        clear: vi.fn(),
      }
      const w = mount(OwnerFolderSharingModal, {
        props: { flow: flow as any, enabled: true },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
      await w.findAll('button')[0].trigger('click')
      await new Promise((r) => setTimeout(r, 0))
      await w.find('input[type=password]').setValue('invented-password')
      await w
        .find('[aria-label="' + field + '"]')
        .setValue(
          field === 'Folder access' ? 'reader' : field === 'Folder path' ? 'Other/' : 'Other name'
        )
      expect(w.text()).not.toContain('Create connection code')
      expect(w.find('input[type=password]').exists()).toBe(false)
      expect(flow.clear).toHaveBeenCalled()
      expect(flow.confirm).not.toHaveBeenCalled()
      w.unmount()
    }
  )
  it('displays exact original paths and clears password after a failed confirmation', async () => {
    const flow = {
      review: vi.fn(async () => ({
        prefix: 'Sample folder/',
        generation: '1',
        complete: true,
        files: [{ path: 'Sample folder/deep/sample.md', eligible: true }],
      })),
      confirm: vi.fn(async () => {
        throw new Error('Rejected confirmation')
      }),
      clear: vi.fn(),
    }
    const w = mount(OwnerFolderSharingModal, {
      props: { flow: flow as any, enabled: true },
      global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
    })
    await w.findAll('button')[0].trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('Sample folder/deep/sample.md')
    expect(w.text()).toContain('Files stay in their current folders')
    await w.find('input[type=password]').setValue('invented-password')
    await w.findAll('button')[1].trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect((w.find('input[type=password]').element as HTMLInputElement).value).toBe('')
    expect(w.find('[role="alert"]').text()).toContain('Could not share this folder')
    expect(w.text()).not.toContain('Rejected confirmation')
    w.unmount()
  })
})
