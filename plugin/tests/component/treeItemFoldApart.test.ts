import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TreeItem from '@/components/obsidian/TreeItem.vue'

describe('independent tree disclosure', () => {
  it('folds through the arrow without navigating; the title still navigates', async () => {
    const row = mount(TreeItem, {
      props: { text: 'Sample question', collapsible: true, collapsed: true, foldApart: true },
    })
    await row.find('.collapse-icon').trigger('click')
    expect(row.emitted('toggle')).toHaveLength(1)
    expect(row.emitted('click')).toBeUndefined()
    await row.find('.tree-item-self').trigger('click')
    expect(row.emitted('click')).toHaveLength(1)
    row.unmount()
  })
  it.fails.each(['disabled', 'plain'] as const)(
    'BUG: does not fold an inert %s row',
    async (mode) => {
      const row = mount(TreeItem, {
        props: { text: 'Sample question', collapsible: true, foldApart: true, [mode]: true },
      })
      await row.find('.collapse-icon').trigger('click')
      expect(row.emitted('toggle')).toBeUndefined()
      expect(row.emitted('click')).toBeUndefined()
      row.unmount()
    }
  )
})
