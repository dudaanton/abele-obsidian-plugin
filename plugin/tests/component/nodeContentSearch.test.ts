import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FileTree from '@/components/nodeWork/FileTree.vue'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'

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
  expect(w.get('.abele-github-search__summary').text()).toContain('Searching')
  expect(w.get('.abele-github-search__summary').text()).not.toContain('Nothing found')
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

it.each(['repo', 'names'] as const)(
  'keeps %s search in progress until an empty scan continuation finishes',
  async (scope) => {
    let finish!: (value: { files: []; total: number; capped: boolean }) => void
    const search = vi.fn(
      () =>
        new Promise<{ files: []; total: number; capped: boolean }>((resolve) => {
          finish = resolve
        })
    )
    const w = mount(GithubCodeSearch, {
      props: {
        code: { refLabel: () => 'sample', search },
        ready: false,
        request: { text: 'needle', scope, nonce: 1 },
      },
    })
    await w.setProps({ ready: true })
    await flushPromises()
    expect(w.get('.abele-github-search__progress').text()).toContain('Searching')
    expect(w.find('.abele-github-search__summary').exists()).toBe(false)
    finish({ files: [], total: 0, capped: false })
    await flushPromises()
    expect(w.get('.abele-github-search__summary').text()).toBe(
      scope === 'names' ? 'No file has a name like that.' : 'Nothing found.'
    )
    w.unmount()
  }
)

it.each(['repo', 'names'] as const)('explains incomplete empty %s searches', async (scope) => {
  const w = mount(GithubCodeSearch, {
    props: {
      code: {
        refLabel: () => 'sample',
        search: vi.fn(async () => ({ files: [], total: 0, capped: true })),
      },
      ready: false,
      request: { text: 'needle', scope, nonce: 1 },
    },
  })
  await w.setProps({ ready: true })
  await flushPromises()
  expect(w.get('.abele-github-search__summary').text()).toContain(
    'Some files or matches were omitted'
  )
  w.unmount()
})

it('shows an empty-search omission notice only once when the result already carries it', async () => {
  const note = 'Some files or matches were omitted'
  const w = mount(GithubCodeSearch, {
    props: {
      code: {
        refLabel: () => 'sample',
        search: vi.fn(async () => ({ files: [], total: 0, capped: true, note })),
      },
      ready: false,
      request: { text: 'needle', scope: 'repo', nonce: 1 },
    },
  })
  await w.setProps({ ready: true })
  await flushPromises()
  expect(w.text().split(note)).toHaveLength(2)
  w.unmount()
})
