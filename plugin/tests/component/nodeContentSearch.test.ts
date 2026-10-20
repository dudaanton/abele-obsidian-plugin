import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FileTree from '@/components/nodeWork/FileTree.vue'

it('opens the shared content search from an ordinary file tree and forwards a highlighted line destination', async () => {
  const next = vi.fn(async () => ({
    files: [
      {
        path: 'deep/sample.ts',
        url: 'sample-file',
        lines: [{ label: '8', text: 'a needle', column: 2, length: 6, url: 'sample-line' }],
      },
    ],
    total: 1,
    capped: false,
  }))
  const search = vi.fn(async () => ({ files: [], total: 0, capped: true, next }))
  const w = mount(FileTree, {
    props: {
      entries: [],
      changes: [],
      mode: 'all',
      codeSearch: { refLabel: () => 'main', search },
    },
  })
  await w.get('[data-node-project-search]').trigger('click')
  const input = w.get('.abele-github-search input')
  await input.setValue('needle')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(search).toHaveBeenCalledWith(
    'repo',
    expect.objectContaining({ text: 'needle' }),
    '',
    expect.any(Function),
    expect.any(AbortSignal)
  )
  await w
    .findAll('button')
    .find((b) => b.text().includes('Load more'))!
    .trigger('click')
  await flushPromises()
  expect(w.get('mark').text()).toBe('needle')
  expect(w.get('.abele-github-search__number').text()).toBe('8')
  await w.get('.abele-github-search__line').trigger('click')
  expect(w.emitted('open-result')).toEqual([['sample-line']])
  w.unmount()
})
