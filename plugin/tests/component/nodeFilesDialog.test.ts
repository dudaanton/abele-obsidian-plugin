import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'
import { useVault } from '../helpers/testEnv'
const stubs = {
  Modal: { template: '<div><slot/><slot name="footer"/></div>' },
  GithubCode: { template: '<div class="sample-code" />' },
  GithubDiffFile: { template: '<div class="sample-diff" />' },
}
it('uses the shared code/diff views and never enables following a listed symbolic link', async () => {
  useVault([])
  const props = await nodeFilesFixture()
  props.model.client.readFile = vi.fn(props.model.client.readFile)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(wrapper.find('.sample-code').exists()).toBe(true)
    const link = wrapper.findAll('button').find((b) => b.text().includes('outside-link'))!
    expect(link.attributes('disabled')).toBeDefined()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Diffs')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Open new snapshot')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sample-diff')).toHaveLength(2)
  } finally {
    wrapper.unmount()
  }
})
it('holds comments on terminal rejection and sends a queued batch only once', async () => {
  useVault([])
  const props = await nodeFilesFixture('review')
  props.model.client.submitReview = vi.fn(async () => ({ operation_id: 'sample-review' }))
  props.model.client.reviewResult = vi.fn(async () => undefined)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(wrapper.find('textarea[aria-label="Review comment"]').exists()).toBe(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Send review (1)')!
      .trigger('click')
    await flushPromises()
    expect(props.model.client.submitReview).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('waiting for confirmation')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Check queued review')!
      .trigger('click')
    await flushPromises()
    expect(props.model.client.submitReview).toHaveBeenCalledTimes(1)
    expect(props.model.comments.value).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
