import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'

afterEach(() => vi.useRealTimers())

it('searches code as it is typed and clears stale results for an empty query', async () => {
  vi.useFakeTimers()
  const search = vi.fn().mockResolvedValue({ files: [], capped: false })
  const w = mount(GithubCodeSearch, { props: { code: { refLabel: () => 'main', search } } })
  await w.get('input').setValue('sample')
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  expect(search).toHaveBeenCalledTimes(1)
  await w.get('input').setValue('')
  await vi.advanceTimersByTimeAsync(300)
  expect(w.find('.abele-github-search__summary').exists()).toBe(false)
  w.unmount()
})

it('does not repeat a search submitted before the debounce expires', async () => {
  vi.useFakeTimers()
  const search = vi.fn().mockResolvedValue({ files: [], capped: false })
  const w = mount(GithubCodeSearch, { props: { code: { refLabel: () => 'main', search } } })
  await w.get('input').setValue('sample')
  await w.get('input').trigger('keydown', { key: 'Enter' })
  await vi.advanceTimersByTimeAsync(300)
  expect(search).toHaveBeenCalledTimes(1)
  w.unmount()
})
