/**
 * A node's files are read again in the background whenever they change. While rows are on
 * screen, that reading must not move them: its state is a glyph in the tree's fixed bar, never
 * a line pushed in over the rows.
 */
import { describe, it, expect } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import FileTree from '@/components/nodeWork/FileTree.vue'
import type { TreeEntry } from '@/components/nodeWork/types'

const entries: TreeEntry[] = [
  {
    path: 'docs',
    name: 'docs',
    kind: 'folder',
    children: [{ path: 'docs/sample.md', name: 'sample.md', kind: 'file' }],
  },
  { path: 'sample-a.ts', name: 'sample-a.ts', kind: 'file' },
  { path: 'sample-b.ts', name: 'sample-b.ts', kind: 'file' },
]

/** What stands before each row in the tree body: the rows keep their offsets iff this holds. */
const layout = (view: VueWrapper) => {
  const body = view.get('.abele-file-tree__body').element
  return [...body.children].map((child) => `${child.tagName}.${child.className}`)
}

describe('FileTree during a background refresh', () => {
  it('loads a folded folder when a newly created file becomes selected inside it', async () => {
    const view = mount(FileTree, {
      props: {
        entries: [{ path: 'sample-folder', name: 'sample-folder', kind: 'folder' }],
        changes: [],
        mode: 'all',
      },
    })
    await view.setProps({ selected: 'sample-folder/new-file.ts' })
    expect(view.emitted('expand')).toContainEqual(['sample-folder'])
    view.unmount()
  })
  it('refreshes filename results after a filesystem operation', async () => {
    let paths = ['sample-old.ts']
    const search = async () => paths.map((path) => ({ path, name: path, kind: 'file' as const }))
    const view = mount(FileTree, {
      props: { entries: [], changes: [], mode: 'all', search, searchKey: 'before' },
    })
    await view.get('input').setValue('sample')
    await flushPromises()
    expect(view.text()).toContain('sample-old.ts')
    paths = ['sample-new.ts']
    await view.setProps({ searchKey: 'after' })
    await flushPromises()
    expect(view.text()).toContain('sample-new.ts')
    expect(view.text()).not.toContain('sample-old.ts')
    view.unmount()
  })
  it('searches the node for files in folders that have never been expanded', async () => {
    const search = async () => [
      { path: 'hidden/deep/sample.ts', name: 'sample.ts', kind: 'file' as const },
    ]
    const view = mount(FileTree, { props: { entries: [], changes: [], mode: 'all', search } })
    await view.get('input').setValue('sample')
    await flushPromises()
    expect(view.text()).toContain('sample.ts')
    expect(view.text()).toContain('hidden/deep')
    view.unmount()
  })
  for (const progress of [
    { state: 'reading' as const, count: 4 },
    { state: 'failed' as const, error: 'Sample read error' },
  ])
    it(`keeps every row where it was while ${progress.state}`, async () => {
      const view = mount(FileTree, { props: { entries, changes: [], mode: 'all', git: false } })
      const before = layout(view)
      const rows = view.findAll('.tree-item-self').map((row) => row.text())
      await view.setProps({ progress })
      expect(layout(view)).toEqual(before)
      expect(view.findAll('.tree-item-self').map((row) => row.text())).toEqual(rows)
      expect(view.get('.abele-file-tree__body').text()).not.toMatch(/Reading the files|Couldn't/)
      // Said in the bar instead, in a slot that is there whether or not anything is read.
      const slot = view.get('.abele-file-tree__bar .abele-file-tree__state')
      expect(slot.find('[aria-label]').exists()).toBe(true)
      await view.setProps({ progress: undefined })
      expect(layout(view)).toEqual(before)
      expect(view.find('.abele-file-tree__bar .abele-file-tree__state').exists()).toBe(true)
    })

  it('retries a failed refresh from the bar', async () => {
    const view = mount(FileTree, {
      props: {
        entries,
        changes: [],
        mode: 'all',
        git: false,
        progress: { state: 'failed', error: 'Sample read error' },
      },
    })
    await view
      .get('.abele-file-tree__state [aria-label^="Couldn\'t read the files"]')
      .trigger('click')
    expect(view.emitted('retry')).toHaveLength(1)
  })
})
