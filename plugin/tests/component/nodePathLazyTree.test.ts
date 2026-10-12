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
