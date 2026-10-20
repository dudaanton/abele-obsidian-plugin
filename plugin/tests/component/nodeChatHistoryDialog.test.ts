import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeChatHistoryDialog from '@/components/NodeChatHistoryDialog.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import { useVault } from '../helpers/testEnv'
const preview = {
  preview_id: 'a'.repeat(64),
  changes: [{ path: 'sample.txt', current: 'b'.repeat(64), checkpoint: 'c'.repeat(64) }],
  files: [
    {
      path: 'sample.txt',
      before_base64: btoa('current'),
      after_base64: btoa('checkpoint'),
      before_mode: 33188,
      after_mode: 33261,
      truncated: true,
    },
  ],
}
const setup = async () => {
  useVault([])
  const restore = vi.fn(async () => {})
  const readPreview = vi.fn(async () => preview)
  const wrapper = mount(NodeChatHistoryDialog, {
    props: { action: 'rewind', initialText: 'Sample question', readPreview, restore },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return { wrapper, restore, readPreview }
}
it('opens and cancels without any restore or automatic file consent', async () => {
  const { wrapper, restore } = await setup()
  try {
    expect(wrapper.getComponent(Checkbox).props('isEnabled')).toBe(false)
    expect(wrapper.text()).toContain('partial')
    await wrapper.get('button[data-history-cancel]').trigger('click')
    expect(restore).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
it('restores only conversation by default and sends the exact shown preview after the explicit switch and click', async () => {
  let f = await setup()
  try {
    await f.wrapper.get('button[data-history-confirm]').trigger('click')
    await flushPromises()
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(undefined, undefined)
  } finally {
    f.wrapper.unmount()
  }
  f = await setup()
  try {
    await f.wrapper.getComponent(Checkbox).trigger('click')
    expect(f.restore).not.toHaveBeenCalled()
    expect(f.wrapper.get('button[data-history-confirm]').text()).toContain('Put files back')
    await f.wrapper.get('button[data-history-confirm]').trigger('click')
    await flushPromises()
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(preview, undefined)
  } finally {
    f.wrapper.unmount()
  }
})
it('holds an uncertain restore without replay, and clears file consent when a new preview is requested', async () => {
  const { wrapper, restore, readPreview } = await setup()
  try {
    restore.mockRejectedValueOnce(new Error('outcome_unknown'))
    await wrapper.getComponent(Checkbox).trigger('click')
    await wrapper.get('button[data-history-confirm]').trigger('click')
    await flushPromises()
    expect(restore).toHaveBeenCalledTimes(1)
    expect(wrapper.get('button[data-history-confirm]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[data-history-refresh]').trigger('click')
    await flushPromises()
    expect(readPreview).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(Checkbox).props('isEnabled')).toBe(false)
    expect(restore).toHaveBeenCalledTimes(1)
  } finally {
    wrapper.unmount()
  }
})
