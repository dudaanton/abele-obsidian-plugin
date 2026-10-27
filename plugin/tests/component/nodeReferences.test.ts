import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { EditorView } from '@codemirror/view'
import { Menu, Platform } from 'obsidian'
import NodeLspFixture from '@/testing/NodeLspFixture.vue'
import { lspFor } from '@/node/lspContext'
import NodeReferenceResults from '@/components/nodeWork/NodeReferenceResults.vue'
import { createReferenceResults, referenceLocationKey } from '@/node/referenceResults'
import { readFileSync } from 'node:fs'
import PathLabel from '@/components/obsidian/PathLabel.vue'
it('shows a muted folder before the filename in file path labels', () => {
  const wrapper = mount(PathLabel, { props: { path: 'src/module/sample.ts', mode: 'file' } })
  expect(wrapper.get('.abele-path-label__folder').text()).toBe('src/module/')
  expect(wrapper.get('.abele-path-label__filename').text()).toBe('sample.ts')
  expect(wrapper.find('.abele-disclosure').exists()).toBe(false)
})
it('shows a single named empty message and activates the Show more link', async () => {
  const state = createReferenceResults()
  state.shown = true
  state.symbol = 'sample'
  const wrapper = mount(NodeReferenceResults, { props: { state } })
  expect(wrapper.text()).toBe('No references to sample.')
  state.count = 110
  state.omitted = 10
  state.more = vi.fn(async () => {})
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Show 10 more')!
    .trigger('click')
  expect(state.more).toHaveBeenCalledOnce()
})
enableAutoUnmount(afterEach)
it('stretches reference headings so the muted counts can align at the far edge', () => {
  const source = readFileSync('src/components/nodeWork/NodeReferenceResults.vue', 'utf8')
  expect(source).toMatch(/\.abele-node-references \.abele-fold-heading\s*\{[^}]*display: flex/s)
  expect(source).toMatch(
    /\.abele-node-references \.abele-fold-heading__count\s*\{[^}]*color: var\(--text-muted\)/s
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(Platform, { isMobile: false, isPhone: false })
})
it('offers references only on a symbol, groups locations and keeps desktop results after opening', async () => {
  mount(NodeLspFixture, { props: { state: 'ready' }, attachTo: document.body })
  await flushPromises()
  const content = document.querySelector<HTMLElement>('.cm-content')!
  const view = EditorView.findFromDOM(content)!
  const point = vi.spyOn(view, 'posAtCoords').mockReturnValue(15)
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const context = lspFor(content)!
  const navigate = vi.spyOn(context, 'navigate').mockImplementation(() => {})
  const range = (line: number) => ({
    start: { line, character: line ? 12 : 13 },
    end: { line, character: line ? 18 : 19 },
  })
  vi.spyOn(context.document, 'query').mockImplementation(async (kind) =>
    kind === 'definition'
      ? [{ path: 'sample.ts', range: range(0) }]
      : [
          { path: 'sample.ts', range: range(1) },
          { path: 'sample.ts', range: range(0) },
        ]
  )
  const menu = () =>
    content
      .querySelector('.cm-line')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  point.mockReturnValue(28)
  menu()
  await flushPromises()
  expect(show).not.toHaveBeenCalled()
  point.mockReturnValue(15)
  menu()
  await flushPromises()
  const item = show.mock.contexts
    .at(-1)!
    .items.find((item) => item.title === 'Find references to sample')!
  expect(item).toBeDefined()
  item.handler?.()
  await flushPromises()
  expect(navigate).not.toHaveBeenCalled()
  expect(document.querySelector('[data-node-references]')?.textContent).toContain(
    '2 references in 1 file'
  )
  const rows = document.querySelectorAll<HTMLElement>('[data-reference-row]')
  expect(rows).toHaveLength(2)
  expect(document.querySelectorAll('[data-reference-file]')).toHaveLength(1)
  expect(document.querySelector('[title="Definition"]')).not.toBeNull()
  expect(rows[1].querySelector('.search-result-file-matched-text')?.textContent).toBe('sample')
  rows[1].click()
  await flushPromises()
  expect(document.querySelector('[data-lsp-destination]')?.textContent).toBe('sample.ts:2')
  expect(document.querySelectorAll('[data-reference-row]')).toHaveLength(2)
  expect(rows[1].classList.contains('is-active')).toBe(true)
})
it('finds references with Shift+F12 and shows the empty result', async () => {
  mount(NodeLspFixture, { props: { state: 'ready' }, attachTo: document.body })
  await flushPromises()
  const content = document.querySelector<HTMLElement>('.cm-content')!
  const view = EditorView.findFromDOM(content)!
  view.dispatch({ selection: { anchor: 15 } })
  const query = vi.spyOn(lspFor(content)!.document, 'query').mockResolvedValue([])
  content.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F12', shiftKey: true, bubbles: true, cancelable: true })
  )
  await flushPromises()
  expect(query).toHaveBeenCalledWith('references', { line: 0, character: 13 }, expect.any(String))
  expect(document.querySelector('[data-node-references]')?.textContent).toContain('No references')
})
it('keeps original-file snippets accurate after navigating to a different reference file', async () => {
  mount(NodeLspFixture, { props: { state: 'ready' }, attachTo: document.body })
  await flushPromises()
  document
    .querySelector('[data-lsp-settle]')!
    .dispatchEvent(new CustomEvent('reference-mode', { detail: 'several' }))
  await flushPromises()
  await lspFor(document.querySelector('.cm-content')!)!.references!('sample', {
    line: 0,
    character: 13,
  })
  await flushPromises()
  const row = [...document.querySelectorAll<HTMLElement>('[data-reference-row]')].find((row) =>
    row.dataset.referenceRow!.includes('src/sample-001.ts')
  )!
  row.click()
  await flushPromises()
  await lspFor(document.querySelector('.cm-content')!)!.references!('sample', {
    line: 0,
    character: 2,
  })
  await flushPromises()
  const group = document.querySelector('[data-reference-file="sample.ts"]')!
  expect(group.textContent).toContain('export const sample: string = 42')
  expect(group.textContent).toContain('console.log(sample)')
})

it('folds after twelve files and closes the tall phone modal on navigation', async () => {
  Object.assign(Platform, { isMobile: true, isPhone: true })
  const state = createReferenceResults()
  state.shown = true
  for (let i = 0; i < 14; i++) {
    const hit = {
      path: `sample-${i}.ts`,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
    }
    const url = referenceLocationKey(hit)
    state.locations[url] = hit
    state.files.push({
      path: hit.path,
      url: hit.path,
      lines: [{ url, label: '1', text: 'sample()', column: 0, length: 6 }],
    })
  }
  state.count = 14
  const wrapper = mount(NodeReferenceResults, { props: { state }, attachTo: document.body })
  await flushPromises()
  expect(document.querySelector('.modal.mod-lg')).not.toBeNull()
  expect(document.querySelectorAll('[data-reference-file]')).toHaveLength(14)
  expect(document.querySelectorAll('[data-reference-row]')).toHaveLength(12)
  const row = document.querySelector<HTMLElement>('[data-reference-row]')!
  row.click()
  await flushPromises()
  expect(state.shown).toBe(false)
  expect(wrapper.emitted('open')?.[0]).toEqual([Object.values(state.locations)[0]])
  expect(state.files).toHaveLength(14)
})
