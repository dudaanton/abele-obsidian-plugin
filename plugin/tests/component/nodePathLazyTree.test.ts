import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '@/components/nodeWork/FileTree.vue'

it('requests children only on expansion and exposes paged continuation actions', async () => {
  const wrapper = mount(FileTree, {
    props: {
      entries: [{ path: 'src', name: 'src', kind: 'folder' }],
      changes: [],
      mode: 'all',
      cursors: { '': 'sample-root-next' },
    },
  })
  expect(wrapper.emitted('expand')).toBeUndefined()
  const folder = wrapper.findAll('.tree-item-self').find((row) => row.text() === 'src')!
  await folder.trigger('click')
  expect(wrapper.emitted('expand')).toEqual([['src']])
  const more = wrapper
    .findAll('.tree-item-self')
    .find((row) => row.text().includes('Load more files'))!
  await more.trigger('click')
  expect(wrapper.emitted('more')).toEqual([['']])
  wrapper.unmount()
})

it('expands only the selected file ancestors as their lazy pages arrive', async () => {
  const wrapper = mount(FileTree, {
    props: {
      entries: [
        { path: 'packages', name: 'packages', kind: 'folder' },
        { path: 'other', name: 'other', kind: 'folder' },
      ],
      changes: [],
      mode: 'all',
    },
  })
  expect(wrapper.emitted('expand')).toBeUndefined()
  await wrapper.setProps({ selected: 'packages/sample/src/example.ts' })
  expect(wrapper.emitted('expand')).toEqual([['packages']])
  await wrapper.setProps({
    entries: [
      {
        path: 'packages',
        name: 'packages',
        kind: 'folder',
        children: [
          { path: 'packages/sample', name: 'sample', kind: 'folder' },
          { path: 'packages/neighbour', name: 'neighbour', kind: 'folder' },
        ],
      },
      { path: 'other', name: 'other', kind: 'folder' },
    ],
  })
  expect(wrapper.emitted('expand')).toEqual([['packages'], ['packages/sample']])
  wrapper.unmount()
})
