import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import ScopedCreationModal from '@/components/sync/ScopedCreationModal.vue'
describe('scoped creation disabled UI', () => {
  it('is an exact-path no-effect preview and does not treat missing paste evidence as permission', async () => {
    const flow = { review: vi.fn(), confirm: vi.fn(), close: vi.fn() },
      w = mount(ScopedCreationModal, {
        props: { flow: flow as any },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('never replaced')
    await w.findAll('button')[0].trigger('click')
    expect(flow.review).not.toHaveBeenCalled()
    expect(flow.confirm).not.toHaveBeenCalled()
    w.unmount()
  })
  it('editing the path/root after review invalidates the exact confirmation', async () => {
    const flow = {
        review: vi.fn(async () => ({
          id: 'sample-review',
          path: 'Scattered/new.md',
          sha: 'a'.repeat(64),
          kind: 'note',
        })),
        confirm: vi.fn(),
        close: vi.fn(),
      },
      w = mount(ScopedCreationModal, {
        props: { flow: flow as any, enabled: true },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
    await w.findAll('button')[0].trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('Create reviewed file')
    await w.find('[aria-label="Scoped new-file path"]').setValue('Other/new.md')
    expect(w.text()).not.toContain('Create reviewed file')
    expect(flow.close).toHaveBeenCalled()
    w.unmount()
  })
})
