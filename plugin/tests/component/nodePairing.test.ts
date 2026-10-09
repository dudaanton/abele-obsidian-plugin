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
    nodes: ref([]),
    deviceKeys: {
      load: vi.fn(async () => undefined),
      pending: vi.fn(async () => []),
      finishEnrollment: vi.fn(async () => true),
      authorizeEndpointChange: vi.fn(),
    },
    pairedConnector: { authorizeNodeKeyChange: vi.fn() },
    pair: vi.fn(async () => node),
    deviceFingerprint: vi.fn(async () => 'c'.repeat(64)),
    connection: () => connection,
  }
  return { service, connection }
}
const options = { global: { stubs: { Modal: { template: '<div><slot /></div>' } } } }

it('resumes an unprocessed re-pair invitation despite an old installation and registration', async () => {
  const { service, connection } = fixture()
  const old = {
    id: 'sample-registration',
    label: 'Sample node',
    profile: 'paired-wss-v1',
    expectedNodeId: invite.node_id,
    installationId: 'sample-installation',
    url: invite.endpoint,
    nodeFingerprint: invite.node_fingerprint,
  }
  service.nodes.value = [old] as never
  const saved = {
    node_id: invite.node_id,
    endpoint: invite.endpoint,
    node_fingerprint: invite.node_fingerprint,
    installation_id: old.installationId,
    enrollment: { invite, label: old.label },
  }
  service.deviceKeys.pending.mockResolvedValue([saved] as never)
  service.deviceKeys.load.mockResolvedValue(saved as never)
  const wrapper = mount(NodePairingDialog, {
    ...options,
    props: { service: service as never, resumeNodeId: invite.node_id },
  })
  try {
    await flushPromises()
    const pair = wrapper.findAll('button').find((b) => b.text() === 'Pair this device')
    expect(pair?.exists()).toBe(true)
    expect(connection.connect).not.toHaveBeenCalled()
    await pair!.trigger('click')
    await flushPromises()
    expect(service.pair).toHaveBeenCalledWith(old.label, invite)
  } finally {
    wrapper.unmount()
  }
})

it('captures the acknowledged enrollment before connecting and does not confirm a newer attempt', async () => {
  const { service, connection } = fixture()
  const node = {
    id: 'sample-registration',
    profile: 'paired-wss-v1',
    expectedNodeId: invite.node_id,
    installationId: 'sample-installation',
    url: invite.endpoint,
    nodeFingerprint: invite.node_fingerprint,
  }
  const claim = {
    installation_id: node.installationId,
    device_fingerprint: 'c'.repeat(64),
    state: 'pending',
  }
  const saved = {
    node_id: invite.node_id,
    endpoint: invite.endpoint,
    node_fingerprint: invite.node_fingerprint,
    installation_id: node.installationId,
    enrollment: { invite, label: 'Sample node', claim },
  }
  service.nodes.value = [node] as never
  service.deviceKeys.pending.mockResolvedValue([saved] as never)
  service.deviceKeys.load.mockResolvedValue(saved as never)
  let complete!: () => void
  connection.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }) as never
  )
  service.deviceKeys.finishEnrollment.mockResolvedValue(false)
  const wrapper = mount(NodePairingDialog, {
    ...options,
    props: { service: service as never, resumeNodeId: invite.node_id },
  })
  try {
    await flushPromises()
    expect(connection.connect).toHaveBeenCalledTimes(1)
    service.deviceKeys.load.mockResolvedValue({
      ...saved,
      enrollment: {
        ...saved.enrollment,
        invite: { ...invite, invite_id: 'sample-new-invitation' },
      },
    } as never)
    complete()
    await flushPromises()
    expect(service.deviceKeys.finishEnrollment).toHaveBeenCalledWith(invite.node_id, {
      node_id: invite.node_id,
      invite_id: invite.invite_id,
      endpoint: invite.endpoint,
      node_fingerprint: invite.node_fingerprint,
      installation_id: node.installationId,
      device_fingerprint: claim.device_fingerprint,
    })
    expect(wrapper.text()).not.toContain('Connected over paired WSS')
    expect(wrapper.text()).toContain('Pairing changed in another window')
  } finally {
    wrapper.unmount()
  }
})

it('requires explicit endpoint verification with an unchanged node fingerprint', async () => {
  const { service } = fixture()
  const previous = 'wss://previous.example.ts.net:9443/channel'
  service.deviceKeys.load.mockResolvedValue({
    node_fingerprint: invite.node_fingerprint,
    endpoint: previous,
  } as never)
  service.deviceKeys.authorizeEndpointChange = vi.fn()
  const wrapper = mount(NodePairingDialog, { ...options, props: { service: service as never } })
  try {
    await wrapper.get('textarea[aria-label="Node invitation"]').setValue(JSON.stringify(invite))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Review invitation')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(previous)
    expect(wrapper.text()).toContain(invite.endpoint)
    const pair = wrapper.findAll('button').find((b) => b.text() === 'Pair this device')!
    expect(pair.attributes('disabled')).toBeDefined()
    expect(service.deviceKeys.authorizeEndpointChange).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="Owner verified new endpoint"]').setValue(true)
    await pair.trigger('click')
    await flushPromises()
    expect(service.deviceKeys.authorizeEndpointChange).toHaveBeenCalledWith(
      invite,
      previous,
      invite.node_fingerprint
    )
    expect(service.pairedConnector.authorizeNodeKeyChange).not.toHaveBeenCalled()
    expect(service.pair).toHaveBeenCalledWith('Remote node', invite)
  } finally {
    wrapper.unmount()
  }
})

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

it('restores a lost-response invitation without sending it until explicitly retried', async () => {
  const { service } = fixture()
  service.deviceKeys.pending.mockResolvedValue([
    { node_id: invite.node_id, enrollment: { invite, label: 'Sample restored node' } },
  ] as never)
  const wrapper = mount(NodePairingDialog, { ...options, props: { service: service as never } })
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Resume pairing: Sample restored node')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(invite.node_fingerprint)
    expect(service.pair).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Pair this device')!
      .trigger('click')
    await flushPromises()
    expect(service.pair).toHaveBeenCalledWith('Sample restored node', invite)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Use another invitation')).toBe(true)
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
