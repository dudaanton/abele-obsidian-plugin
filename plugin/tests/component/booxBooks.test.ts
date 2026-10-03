import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import BooxBooksModal from '@/components/sync/BooxBooksModal.vue'
describe('untrusted Books role and setup UI', () => {
  it('default preview has only a scoped secret field, never a personal login or publisher action', async () => {
    const flow = { setup: vi.fn(), close: vi.fn() },
      w = mount(BooxBooksModal, {
        props: { flow: flow as any },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('Editor — reads and writes')
    expect(w.text()).toContain('never an account or personal device token')
    expect(w.text()).toContain('not remote deletions')
    expect(w.find('[aria-label="Books scoped secret"]').attributes('type')).toBe('password')
    await w.findAll('button')[0].trigger('click')
    expect(flow.setup).not.toHaveBeenCalled()
    w.unmount()
  })
  it.each(['revoked', 'unsupported-transport', 'preparing', 'offline'])(
    'shows %s as an actionable hold rather than synced',
    (state) => {
      const w = mount(BooxBooksModal, {
        props: {
          status: { status: state as any, role: 'editor', known: 10, materialized: 4, omitted: 6 },
        },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
      expect(w.text()).toContain(state)
      expect(w.text()).not.toContain('synced')
      expect(w.text()).toContain('omitted/known-not-materialized: 6')
      w.unmount()
    }
  )
})
