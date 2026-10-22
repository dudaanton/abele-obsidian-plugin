import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TreeItem from '@/components/obsidian/TreeItem.vue'

describe('independent tree disclosure', () => {
  it('selects the whole name and commits or cancels an in-row rename', async () => {
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample name', renaming: true },
      slots: { end: '<time>12:00</time>', actions: '<button>Action</button>' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const editor = row.get('[contenteditable]')
    expect(document.getSelection()?.toString()).toBe('Sample name')
    expect(row.find('.tree-item-flair-outer').exists()).toBe(false)
    editor.element.textContent = 'New name'
    await row.setProps({ text: 'Background title update' })
    expect(editor.element.textContent).toBe('New name')
    await editor.trigger('keydown', { key: 'Enter' })
    expect(row.emitted('rename')?.[0]).toEqual(['New name'])
    await editor.trigger('blur')
    expect(row.emitted('rename')).toHaveLength(1)
    await row.setProps({ renaming: false })
    await row.setProps({ renaming: true })
    await row.get('[contenteditable]').trigger('keydown', { key: 'Escape' })
    await row.get('[contenteditable]').trigger('blur')
    expect(row.emitted('rename-cancel')).toHaveLength(1)
    expect(row.emitted('rename')).toHaveLength(1)
    row.unmount()
  })
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
  it.each(['disabled', 'plain'] as const)('does not fold an inert %s row', async (mode) => {
    const row = mount(TreeItem, {
      props: { text: 'Sample question', collapsible: true, foldApart: true, [mode]: true },
    })
    await row.find('.collapse-icon').trigger('click')
    expect(row.emitted('toggle')).toBeUndefined()
    expect(row.emitted('click')).toBeUndefined()
    row.unmount()
  })
})
