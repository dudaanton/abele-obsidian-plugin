import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import ScopedInvitationModal from '@/components/sync/ScopedInvitationModal.vue'
describe('scoped invitation disabled UI', () => {
  it('shows no-remap/no-local-publication and script-refuse safeguards without requesting credentials', async () => {
    const flow = { begin: vi.fn(), resume: vi.fn(), close: vi.fn() },
      w = mount(ScopedInvitationModal, {
        props: { flow: flow as any, enabled: false },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('unrelated local files')
    expect(w.text()).toContain('scripts are refused')
    await w.findAll('button')[0].trigger('click')
    expect(flow.begin).not.toHaveBeenCalled()
    expect(flow.resume).not.toHaveBeenCalled()
    w.unmount()
    expect(flow.close).toHaveBeenCalled()
  })
})
