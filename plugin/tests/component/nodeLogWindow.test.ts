import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import LogWindow from '@/components/nodeWork/LogWindow.vue'
import { NodeLogModel } from '@/node/NodeLogModel'

it('shows an empty filter and keeps escaped loaded evidence when offline', async () => {
  const read = vi.fn().mockResolvedValue({
    lines: [{ time: null, level: 'info', text: '<img src="sample">', source: 'stdout' }],
    truncated: false,
    files: [],
  })
  const model = new NodeLogModel({ online: () => true, read })
  await model.refresh()
  const view = mount(LogWindow, { props: { model, version: '0.4.50' } })
  expect(view.get('.abele-node-log__facts').text()).toBe('Node 0.4.50')
  expect(view.get('.abele-node-log__text').text()).toBe('<img src="sample">')
  expect(view.find('img').exists()).toBe(false)
  model.level.value = 'warn'
  await flushPromises()
  expect(view.text()).toContain('No log entries')
  model.level.value = 'all'
  await view.setProps({ offline: true })
  expect(view.get('.abele-node-log__offline').text()).toContain('when the node is online')
  expect(view.get('.abele-node-log__text').text()).toBe('<img src="sample">')
  view.unmount()
  model.destroy()
})
