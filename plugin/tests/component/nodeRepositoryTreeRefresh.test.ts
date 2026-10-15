/**
 * A node's files are in its side panel, not in a tree beside the repository tab. The panel's
 * tree keeps what the person opened, its rows and its scroll across the node's refreshes, and
 * shows a real change in place.
 */
import { expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileTree from '@/components/nodeWork/FileTree.vue'
import type { TreeEntry } from '@/components/nodeWork/types'

const file = (path: string): TreeEntry => ({ path, name: path.split('/').pop()!, kind: 'file' })
const folder = (path: string, children?: TreeEntry[]): TreeEntry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'folder',
  ...(children ? { children } : {}),
})
const rows = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.tree-item-self').map((row) => row.attributes('data-path'))

it('keeps open folders, rows and scroll in the file tree across node refreshes', async () => {
  const read = (inner: string[], root: string[]) => [
    folder('src', inner.map(file)),
    ...root.map(file),
  ]
  const wrapper = mount(FileTree, {
    attachTo: document.body,
    props: { entries: read(['src/inner.ts'], ['app.ts', 'README.md']), changes: [], mode: 'all' },
  })
  await wrapper.find('[data-path="src"]').trigger('click')
  await flushPromises()
  expect(rows(wrapper)).toContain('src/inner.ts')
  const body = wrapper.find('.abele-file-tree__body').element as HTMLElement
  body.scrollTop = 40
  const row = wrapper.find('[data-path="src/inner.ts"]').element

  // Several refresh cycles with nothing changed: the same entries arrive anew, nothing moves.
  for (let i = 0; i < 3; i++) {
    await wrapper.setProps({ entries: read(['src/inner.ts'], ['app.ts', 'README.md']) })
    await flushPromises()
  }
  expect(wrapper.text()).not.toContain('Reading the files')
  expect(wrapper.find('[data-path="src/inner.ts"]').element).toBe(row)
  expect(body.scrollTop).toBe(40)
  expect(wrapper.find('.abele-file-tree__body').element).toBe(body)

  // A real change shows up in place, the folder still open.
  await wrapper.setProps({ entries: read(['src/inner.ts', 'src/added.ts'], ['app.ts']) })
  await flushPromises()
  expect(rows(wrapper)).toContain('src/added.ts')
  expect(rows(wrapper)).toContain('src/inner.ts')
  expect(rows(wrapper)).not.toContain('README.md')
  expect(wrapper.find('[data-path="src/inner.ts"]').element).toBe(row)
  wrapper.unmount()
})
