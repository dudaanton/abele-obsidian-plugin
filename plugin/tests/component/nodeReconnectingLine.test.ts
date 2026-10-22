import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NodePanel from '@/components/nodeWork/NodePanel.vue'

it('keeps a bottom status row outside the scroll area across connection recovery', async () => {
  const view = mount(NodePanel, {
    props: {
      phase: 'ready',
      node: { name: 'Sample node', status: 'offline' },
      error: 'No answer from the node. Reconnecting; the request may have completed.',
    } as never,
    slots: { default: '<div data-tree>Sample tree</div>' },
  })
  try {
    const footer = view.get('[data-connection-footer]').element
    expect(view.get('.abele-node-panel__content [data-tree]').exists()).toBe(true)
    expect(view.get('.abele-node-panel__content').element.contains(footer)).toBe(false)
    expect(view.get('[data-connection-status]').text()).toBe(
      'No answer from the node. Reconnecting…'
    )
    expect(view.get('[data-connection-status] .abele-status-dot_orange').exists()).toBe(true)
    expect(view.find('.abele-node-panel__notice').exists()).toBe(false)
    await view.setProps({ error: '', node: { name: 'Sample node', status: 'connected' } } as never)
    expect(view.find('[data-connection-status]').exists()).toBe(false)
    expect(view.get('[data-connection-footer]').element).toBe(footer)
    expect(view.get('[data-tree]').text()).toBe('Sample tree')
    await view.setProps({ error: 'Sample action failed' })
    expect(view.get('.abele-node-panel__notice').text()).toContain('Sample action failed')
  } finally {
    view.unmount()
  }
})
