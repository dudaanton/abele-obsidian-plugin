import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MigrationModal from '@/components/ExcalidrawMigrationModal.vue'
import { excalidrawDrawings, excalidrawReport } from '@/testing/excalidrawFixture'

vi.mock('@/components/obsidian/Modal.vue', () => ({
  default: { template: '<div><slot /><slot name="footer" /></div>' },
}))

function dialog(run = vi.fn().mockResolvedValue(excalidrawReport())) {
  return mount(MigrationModal, {
    props: { drawings: excalidrawDrawings, run },
    global: { stubs: { Icon: true } },
  })
}

describe('Excalidraw migration report', () => {
  it('keeps each source and its own losses and skipped result in the report', async () => {
    const wrapper = dialog()
    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Migrate '))!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Sample plan.excalidraw.md')
    expect(wrapper.text()).toContain('Old sample.excalidraw.md')
    expect(wrapper.text()).toContain('Hand-drawn look ×14')
    wrapper.unmount()
  })

  it('shows an enumeration failure instead of rejecting the click handler', async () => {
    const wrapper = dialog(vi.fn().mockRejectedValue(new Error('Sample read failure')))
    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Migrate '))!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Sample read failure')
    expect(wrapper.text()).toContain('Done')
    wrapper.unmount()
  })
})
