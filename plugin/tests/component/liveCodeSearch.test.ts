import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'

afterEach(() => vi.useRealTimers())

it('loads another page without losing matches and keeps them visible if the next page fails', async () => {
  const file = {
    path: 'sample.ts',
    url: 'sample-file',
    lines: [{ label: '4', text: 'a needle', column: 2, length: 6, url: 'sample-line' }],
  }
  const next = vi.fn().mockRejectedValue(new Error('Sample page unavailable'))
  const search = vi.fn().mockResolvedValue({ files: [file], total: 1, capped: true, next })
  const w = mount(GithubCodeSearch, { props: { code: { refLabel: () => 'main', search } } })
  await w.get('input').setValue('needle')
  await w.get('input').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(w.get('mark').text()).toBe('needle')
  await w
    .findAll('button')
    .find((b) => b.text().includes('Load more'))!
    .trigger('click')
  await flushPromises()
  expect(next).toHaveBeenCalledTimes(1)
  expect(w.get('.abele-github-search__path').text()).toContain('sample.ts')
  expect(w.get('.abele-github-search__error').text()).toContain('Sample page unavailable')
  next.mockResolvedValueOnce({ files: [file], total: 1, capped: false } as never)
  await w
    .findAll('button')
    .find((b) => b.text().includes('Load more'))!
    .trigger('click')
  await flushPromises()
  expect(w.find('.abele-github-search__error').exists()).toBe(false)
  expect(w.get('.abele-github-search__path').text()).toContain('sample.ts')
  w.unmount()
})

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
