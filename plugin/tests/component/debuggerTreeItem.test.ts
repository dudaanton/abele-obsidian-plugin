import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { expect, it } from 'vitest'
import TreeItem from '@/components/obsidian/TreeItem.vue'
it('retains the native row with a readable note and noninteractive end slot', () => {
  const w = mount(TreeItem, {
    props: { text: 'sample', note: 'sample.ts:7' },
    slots: { end: () => h('span', '12') },
  })
  expect(w.get('.abele-tree-item__note').text()).toBe('sample.ts:7')
  expect(w.get('.tree-item-flair-outer').text()).toBe('12')
  w.unmount()
})
