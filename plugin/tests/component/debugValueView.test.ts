import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import DebugValueView from '@/components/debugger/DebugValueView.vue'
import { mountCode } from '@/github/codeViewer'

vi.mock('@/github/codeViewer', () => ({
  mountCode: vi.fn(() => ({ destroy: vi.fn() })),
}))

it('shows formatted or exact raw text and uses actual editor wrapping', async () => {
  const value = '{"sample":1}'
  const w = mount(DebugValueView, { props: { name: 'payload', value } })
  await nextTick()
  expect(vi.mocked(mountCode).mock.lastCall?.[1]).toBe('{\n  "sample": 1\n}')
  expect(vi.mocked(mountCode).mock.lastCall?.[7]).toBe(false)
  const viewer = vi.mocked(mountCode).mock.results.at(-1)!.value
  await w.setProps({ mode: 'raw', wrap: true })
  await nextTick()
  expect(viewer.destroy).toHaveBeenCalledOnce()
  expect(vi.mocked(mountCode).mock.lastCall?.[1]).toBe(value)
  expect(vi.mocked(mountCode).mock.lastCall?.[7]).toBe(true)
  const last = vi.mocked(mountCode).mock.results.at(-1)!.value
  w.unmount()
  expect(last.destroy).toHaveBeenCalledOnce()
})

it('does not mount an editor after its tab has already closed', async () => {
  const w = mount(DebugValueView, { props: { name: 'sample', value: 'sample' } })
  w.unmount()
  await nextTick()
  expect(mountCode).not.toHaveBeenCalled()
})
