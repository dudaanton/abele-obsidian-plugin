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

it('puts where a file lies on its own line under the name, the whole path in its label', () => {
  const w = mount(TreeItem, { props: { text: 'sample.ts', where: 'packages/sample/src' } })
  const named = w.get('.abele-tree-item__named')
  expect(named.get('.abele-tree-item__text').text()).toBe('sample.ts')
  expect(named.get('.abele-tree-item__where').text()).toBe('packages/sample/src')
  expect(w.find('.abele-tree-item__note').exists()).toBe(false)
  expect(w.get('.tree-item-self').attributes('aria-label')).toBe('packages/sample/src/sample.ts')
  w.unmount()
})

it('keeps a file at the top of its tree to its name alone', () => {
  const w = mount(TreeItem, { props: { text: 'sample.ts', where: '' } })
  expect(w.find('.abele-tree-item__where').exists()).toBe(false)
  expect(w.get('.tree-item-self').attributes('aria-label')).toBeUndefined()
  w.unmount()
})

it('names a row in its tooltip when its glyph already says the state', () => {
  const w = mount(TreeItem, { props: { text: 'old-branch', label: 'old-branch · missing from disk' } })
  expect(w.find('.abele-tree-item__note').exists()).toBe(false)
  expect(w.get('.tree-item-self').attributes('aria-label')).toBe('old-branch · missing from disk')
  w.unmount()
})
