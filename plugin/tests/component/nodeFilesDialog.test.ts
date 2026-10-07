import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'
import { useVault } from '../helpers/testEnv'
const stubs = {
  Modal: { template: '<div><slot/><slot name="footer"/></div>' },
  GithubCode: {
    name: 'GithubCode',
    props: ['range', 'focus'],
    template: '<div class="sample-code" />',
  },
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
it('retains the snapshot of an existing selection when another snapshot is published', async () => {
  useVault([])
  const props = await nodeFilesFixture('review')
  const selectedId = props.model.snapshot.value!.diff_id
  const capture = props.model.client.captureDiff
  props.model.client.captureDiff = async (...args) => ({
    ...(await capture(...args)),
    diff_id: 'newer-snapshot',
  })
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    await props.model.loadDiff('staged')
    await flushPromises()
    await wrapper.find('textarea').setValue('Keep the original selection')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Add to review')!
      .trigger('click')
    await flushPromises()
    expect(props.model.comments.value.at(-1)?.diff_id).toBe(selectedId)
  } finally {
    wrapper.unmount()
  }
})
it('discards a pending snapshot request when the dialog closes', async () => {
  useVault([])
  const props = await nodeFilesFixture('diffs')
  const snapshot = { ...props.model.snapshot.value!, diff_id: 'closed-view' }
  let resolve!: (value: typeof snapshot) => void
  props.model.client.captureDiff = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Open new snapshot')!
      .trigger('click')
    wrapper.unmount()
    resolve(snapshot)
    await flushPromises()
    expect(props.model.snapshot.value?.diff_id).toBe('sample-immutable-snapshot')
  } finally {
    if (wrapper.exists()) wrapper.unmount()
  }
})
it('splits node line fragments before file reads and supplies the shared code-view range', async () => {
  useVault([])
  const props = await nodeFilesFixture('files')
  const path = props.initialPath!
  props.initialPath = path + '#L12-L20'
  props.model.client.readFile = vi.fn(props.model.client.readFile)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(props.model.client.readFile).toHaveBeenCalledWith(props.model.workspaceId, path)
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('range')).toEqual({
      start: 12,
      end: 20,
    })
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('focus')).toMatchObject({ line: 12 })
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
