import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodePairingDialog from '@/components/NodePairingDialog.vue'
import { ref } from 'vue'

const invite = {
  endpoint: 'wss://sample.example.ts.net:8443/channel',
  node_id: 'sample-node',
  node_fingerprint: 'a'.repeat(64),
  invite_id: 'sample-invitation',
  secret: 'b'.repeat(64),
  expires_at: 9999999999999,
}
const fixture = () => {
  const node = { id: 'sample-registration', label: 'Sample node', expectedNodeId: 'sample-node' }
  const connection = {
    state: ref('offline'),
    connect: vi.fn(async () => {
      throw new Error('unauthorized')
    }),
  }
  const service = {
    deviceKeys: {
      load: vi.fn(async () => undefined),
      pending: vi.fn(async () => []),
      finishEnrollment: vi.fn(),
    },
    pairedConnector: { authorizeNodeKeyChange: vi.fn() },
    pair: vi.fn(async () => node),
    deviceFingerprint: vi.fn(async () => 'c'.repeat(64)),
    connection: () => connection,
  }
  return { service, connection }
}
const options = { global: { stubs: { Modal: { template: '<div><slot /></div>' } } } }

it('reviews a pin before claiming, then shows the exact device fingerprint and owner-confirmation state', async () => {
  const { service } = fixture()
  const wrapper = mount(NodePairingDialog, { ...options, props: { service: service as never } })
  try {
    await wrapper.get('textarea[aria-label="Node invitation"]').setValue(JSON.stringify(invite))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Review invitation')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(invite.node_fingerprint)
    expect(service.pair).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Pair this device')!
      .trigger('click')
    await flushPromises()
    expect(service.pair).toHaveBeenCalledWith('Remote node', invite)
    expect(wrapper.text()).toContain('Waiting for owner confirmation')
    expect(wrapper.text()).toContain('c'.repeat(64))
    expect(wrapper.text()).not.toContain(invite.secret)
  } finally {
    wrapper.unmount()
  }
})

it('retries a lost claim reply after explicit pin recovery without authorizing the same change twice', async () => {
  const { service } = fixture()
  service.deviceKeys.load.mockResolvedValue({ node_fingerprint: 'd'.repeat(64) } as never)
  service.pair.mockRejectedValueOnce(new Error('connection_closed'))
  const wrapper = mount(NodePairingDialog, { ...options, props: { service: service as never } })
  try {
    await wrapper.get('textarea[aria-label="Node invitation"]').setValue(JSON.stringify(invite))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Review invitation')!
      .trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="Owner verified new node key"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Pair this device')!
      .trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Pair this device')!
      .trigger('click')
    await flushPromises()
    expect(service.pairedConnector.authorizeNodeKeyChange).toHaveBeenCalledTimes(1)
    expect(service.pair).toHaveBeenCalledTimes(2)
  } finally {
    wrapper.unmount()
  }
})

it('does not change a node pin automatically; explicit recovery displays both fingerprints', async () => {
  const { service } = fixture()
  service.deviceKeys.load.mockResolvedValue({ node_fingerprint: 'd'.repeat(64) } as never)
  const wrapper = mount(NodePairingDialog, { ...options, props: { service: service as never } })
  try {
    await wrapper.get('textarea[aria-label="Node invitation"]').setValue(JSON.stringify(invite))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Review invitation')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('d'.repeat(64))
    expect(wrapper.text()).toContain('a'.repeat(64))
    const pair = wrapper.findAll('button').find((b) => b.text() === 'Pair this device')!
    expect(pair.attributes('disabled')).toBeDefined()
    expect(service.pairedConnector.authorizeNodeKeyChange).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="Owner verified new node key"]').setValue(true)
    await pair.trigger('click')
    await flushPromises()
    expect(service.pairedConnector.authorizeNodeKeyChange).toHaveBeenCalledWith(
      invite,
      'd'.repeat(64)
    )
  } finally {
    wrapper.unmount()
  }
})
