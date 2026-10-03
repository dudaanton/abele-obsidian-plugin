import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SidebarPanel from '@/components/obsidian/SidebarPanel.vue'

describe('sidebar shell', () => {
  it('keeps one scroll owner, forwarded classes and all slot content', () => {
    const view = mount(SidebarPanel, {
      attrs: { class: 'sample-sidebar', 'data-sample': 'panel' },
      slots: { default: '<p>Sample row</p>' },
    })
    expect(view.element.tagName).toBe('DIV')
    expect(view.classes()).toContain('abele-sidebar-panel')
    expect(view.classes()).toContain('sample-sidebar')
    expect(view.attributes('data-sample')).toBe('panel')
    expect(view.find('p').text()).toBe('Sample row')
    expect(view.emitted('element')?.[0]).toEqual([view.element])
    view.unmount()
  })
})
