import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GithubCode from '@/components/github/GithubCode.vue'
const f = vi.hoisted(() => ({
  pin: vi.fn(() => () => {}),
  viewer: {
    mark: vi.fn(),
    targetTop: () => 200,
    lineTop: () => 200,
    destroy: vi.fn(),
    blame: vi.fn(),
  },
}))
vi.mock('@/github/codeViewer', () => ({ mountCode: () => f.viewer }))
vi.mock('@/github/scrollTo', async (original) => ({
  ...(await original<typeof import('@/github/scrollTo')>()),
  pinIntoView: f.pin,
}))
it('retains short-pane visibility when an existing linked file receives another range', async () => {
  const view = mount(GithubCode, {
    props: {
      text: 'sample\nsecond',
      path: 'src/sample.ts',
      range: { start: 1, end: 1 },
      keepVisibleInShortPane: true,
    },
  })
  await flushPromises()
  f.pin.mockClear()
  await view.setProps({ range: { start: 2, end: 2 } })
  await flushPromises()
  expect(f.pin).toHaveBeenLastCalledWith(
    expect.any(HTMLElement),
    expect.any(Function),
    expect.objectContaining({ keepVisibleInShortPane: true })
  )
  view.unmount()
})
