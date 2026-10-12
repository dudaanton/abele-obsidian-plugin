import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TreeItem from '@/components/obsidian/TreeItem.vue'

describe('tree row action isolation', () => {
  it('keeps Enter on a child control native and does not navigate the row', async () => {
    const action = vi.fn()
    const view = mount(TreeItem, {
      props: { text: 'Sample file' },
      slots: { actions: '<button type="button">More</button>' },
    })
    const button = view.get('button')
    button.element.addEventListener('click', action)
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(view.emitted('click')).toBeUndefined()
    await button.trigger('click')
    expect(action).toHaveBeenCalledOnce()
    expect(view.emitted('click')).toBeUndefined()
    view.unmount()
  })
})
