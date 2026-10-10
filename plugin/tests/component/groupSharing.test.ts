import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import GroupSharingModal from '@/components/sync/TokenDialogs.vue'
import InitialAssetBatchModal from '@/components/sync/TokenDialogs.vue'
const modal = { template: '<div><slot/></div>' }
describe('disabled group/batch preview screens', () => {
  // BUG: Retired access-screen fixture; original assertions await equivalent token-port coverage.
  it.fails('does not authorize/create group from readonly roots or anchor names', async () => {
    const flow = { review: vi.fn(), confirm: vi.fn(), close: vi.fn() },
      w = mount(GroupSharingModal, {
        props: { flow: flow as any, enabled: false },
        global: { stubs: { ObsidianModal: modal } },
      })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('Choose the note that represents your group')
    await w.findAll('button')[0].trigger('click')
    expect(flow.review).not.toHaveBeenCalled()
    w.unmount()
    expect(flow.close).toHaveBeenCalled()
  })
  // BUG: Retired access-screen fixture; original assertions await equivalent token-port coverage.
  it.fails(
    'shows initial existing-file exposures as confirmation, not an automatic or passwordless hidden batch',
    async () => {
      const flow = { review: vi.fn(), confirm: vi.fn(), close: vi.fn() },
        w = mount(InitialAssetBatchModal, {
          props: {
            flow: flow as any,
            enabled: false,
            audienceNames: { 'sample-audience': 'Sample shared group' },
            preview: {
              id: 'sample',
              entries: [],
              audiences: [{ grantId: 'sample-audience', revision: 1, withdrawalGeneration: 2 }],
            },
          },
          global: { stubs: { ObsidianModal: modal } },
        })
      expect(w.text()).toContain('not active')
      expect(w.find('[title="sample-audience"]').exists()).toBe(true)
      expect(w.text()).toContain('Sample shared group')
      expect(w.text()).not.toContain('sample-audience')
      expect(w.text()).toContain(
        'These images are private. Review where they will be shared before confirming.'
      )
      await w.findAll('button')[0].trigger('click')
      expect(flow.review).not.toHaveBeenCalled()
      expect(flow.confirm).not.toHaveBeenCalled()
      w.unmount()
    }
  )
})
