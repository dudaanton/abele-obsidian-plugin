import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { openNodeLog } from '@/node/nodeLog'

const fake = vi.hoisted(() => ({ connection: null as any, views: [] as VueWrapper[] }))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: { value: [{ id: 'sample-node', label: 'Sample node' }] },
      connection: () => fake.connection,
    }),
  },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: { workspace: { containerEl: document.body } },
    }),
  },
}))
vi.mock('@/components/obsidian/Modal.vue', () => ({
  default: {
    name: 'TestLogModal',
    template: '<div><slot /></div>',
  },
}))
vi.mock('@/components/obsidian/mount', () => ({
  mountKit: (_host: unknown, component: any) => {
    const view = mount(component)
    fake.views.push(view)
    return { unmount: () => view.unmount() }
  },
}))
afterEach(() => {
  for (const view of fake.views.splice(0)) {
    if (view.exists()) view.getComponent({ name: 'TestLogModal' }).vm.$emit('close')
  }
})
const page = (text: string) => ({
  lines: [{ time: null, level: 'info', text, source: 'stdout' }],
  truncated: false,
  files: [],
})
function connect() {
  const channel = { channel: { welcome: { methods: ['node.log.v1.tail'] } } }
  const request = vi.fn().mockResolvedValue(page('Sample first entry'))
  fake.connection = {
    state: ref('connected'),
    authorizationGeneration: 1,
    client: { channel, request },
  }
  return { connection: fake.connection, request, channel }
}
it('reopens saved evidence when a real disconnect clears the client channel', async () => {
  const { connection, request } = connect()
  openNodeLog('sample-node')
  await flushPromises()
  fake.views[0]!.getComponent({ name: 'TestLogModal' }).vm.$emit('close')
  connection.client.channel = undefined
  connection.state.value = 'offline'
  openNodeLog('sample-node')
  await flushPromises()
  expect(fake.views).toHaveLength(2)
  expect(fake.views[1]!.text()).toContain('Sample first entry')
  expect(fake.views[1]!.text()).toContain('when the node is online')
  expect(request).toHaveBeenCalledTimes(1)
})
it('refreshes an open log after reconnect instead of presenting stale evidence as current', async () => {
  const { connection, request, channel } = connect()
  openNodeLog('sample-node')
  await flushPromises()
  connection.client.channel = undefined
  connection.state.value = 'offline'
  await flushPromises()
  expect(fake.views[0]!.text()).toContain('when the node is online')
  request.mockResolvedValue(page('Sample newer entry'))
  connection.client.channel = channel
  connection.state.value = 'connected'
  await flushPromises()
  expect(request).toHaveBeenCalledTimes(2)
  expect(fake.views[0]!.text()).toContain('Sample newer entry')
})
