import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NodePanel from '@/components/nodeWork/NodePanel.vue'

it('renders a transient connection error as a quiet status instead of an in-flow error box', async () => {
  const view = mount(NodePanel, {
    props: {
      phase: 'ready',
      node: { name: 'Sample node', status: 'offline' },
      error: 'No answer from the node. Reconnecting; the request may have completed.',
    } as never,
    slots: { default: '<div data-tree>Sample tree</div>' },
  })
  try {
    expect(view.get('[data-connection-status]').text()).toBe(
      'No answer from the node. Reconnecting…'
    )
    expect(view.get('[data-connection-status] .abele-status-dot_orange').exists()).toBe(true)
    expect(view.find('.abele-node-panel__notice').exists()).toBe(false)
    await view.setProps({ error: '', node: { name: 'Sample node', status: 'connected' } } as never)
    expect(view.find('[data-connection-status]').exists()).toBe(false)
    expect(view.get('[data-tree]').text()).toBe('Sample tree')
    await view.setProps({ error: 'Sample action failed' })
    expect(view.get('.abele-node-panel__notice').text()).toContain('Sample action failed')
  } finally {
    view.unmount()
  }
})
