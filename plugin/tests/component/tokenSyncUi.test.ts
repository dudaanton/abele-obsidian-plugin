import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import Button from '@/components/obsidian/Button.vue'
import Modal from '@/components/obsidian/Modal.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import TokenQrReader from '@/components/sync/TokenQrReader.vue'
import { tokenUiFixture, sampleIssuedToken } from '@/testing/tokenUiFixture'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { Notice } from '../mocks/obsidian'

const modalStub = { template: '<div><slot /><slot name="footer" /></div>' }
it('displays the exact path and server-size reason for an oversized unsent file', async () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.publish(id, {
    pending: 1,
    refused: [
      {
        path: 'Media/oversized.bin',
        reason: 'This file is too large for the server. It stays on this device.',
      },
    ],
  })
  const view = mount(SyncSettings, {
    props: { model: ui },
    global: { stubs: { Modal: modalStub, SelectiveSync: true } },
  })
  await flushPromises()
  await view.find('.abele-sync-row').trigger('click')
  await flushPromises()
  const row = view
    .findAll('.setting-item')
    .find((one) => one.find('.setting-item-name').text() === 'Media/oversized.bin')
  expect(row).toBeDefined()
  expect(row!.find('.setting-item-description').text()).toBe(
    'This file is too large for the server. It stays on this device.'
  )
  view.unmount()
})
function shareFixture() {
  const ui = tokenUiFixture()
  const scope = { kind: 'folder' as const, id: 'root', path: '/' }
  vi.spyOn(ui, 'choices').mockResolvedValue([scope, { ...scope, id: 'other', path: 'Shared' }])
  vi.spyOn(ui, 'issued').mockResolvedValue([
    {
      id: 'issued',
      label: 'Sample',
      scope,
      issued_by_token_id: 'root',
      created_at: '2025-01-01',
      revoked_at: null,
    },
  ])
  return ui
}
it('cancelling a revoke confirmation makes no request', async () => {
  const ui = shareFixture(),
    revoke = vi.fn()
  vi.spyOn(ui, 'client').mockReturnValue({ revoke } as never)
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  await view
    .findAllComponents(Icon)
    .find((one) => one.props('icon') === 'ban')!
    .trigger('click')
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Keep access')!
    .trigger('click')
  expect(revoke).not.toHaveBeenCalled()
  expect(view.text()).not.toContain('Revoke Sample')
  view.unmount()
})
it('shows token list and revoke errors', async () => {
  const ui = shareFixture()
  const issued = vi.spyOn(ui, 'issued').mockRejectedValueOnce(new Error('List failed'))
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('could not finish')
  view.unmount()
  issued.mockResolvedValue([
    {
      id: 'issued',
      label: 'Sample',
      scope: { kind: 'folder', id: 'root', path: '/' },
      issued_by_token_id: 'root',
      created_at: '2025-01-01',
      revoked_at: null,
    },
  ])
  vi.spyOn(ui, 'client').mockReturnValue({
    revoke: async () => {
      throw new Error('Revoke failed')
    },
  } as never)
  const next = mount(TokenDialogs, {
    props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
    global: { stubs: { Modal: modalStub } },
  })
  await flushPromises()
  await next
    .findAllComponents(Icon)
    .find((one) => one.props('icon') === 'ban')!
    .trigger('click')
  await next
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Revoke')!
    .trigger('click')
  await flushPromises()
  expect(next.get('[role="alert"]').text()).toContain('could not finish')
  next.unmount()
})
it.each(['close', 'scope', 'connection'] as const)(
  'discards a late issued token after %s',
  async (change) => {
    const ui = shareFixture()
    let answer!: (value: { token: string }) => void
    vi.spyOn(ui, 'client').mockReturnValue({
      issue: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    } as never)
    const view = mount(TokenDialogs, {
      props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
      global: { stubs: { Modal: modalStub } },
    })
    await flushPromises()
    await view.find('input').setValue('Sample access')
    await view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Create token')!
      .trigger('click')
    if (change === 'close') view.findComponent(Modal).vm.$emit('close')
    else if (change === 'scope') view.findComponent(Dropdown).vm.$emit('update:model-value', '1')
    else await view.setProps({ connectionId: ui.rows.value[1].id })
    await flushPromises()
    answer({ token: 'late-secret-token' })
    await flushPromises()
    expect(view.text()).not.toContain('New token')
    expect(view.html()).not.toContain('late-secret-token')
    view.unmount()
  }
)
it.each(['close', 'scope', 'connection'] as const)(
  'discards a late access list after %s',
  async (change) => {
    const ui = shareFixture()
    let answer!: (value: Awaited<ReturnType<TokenUi['issued']>>) => void
    vi.spyOn(ui, 'issued')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve
          })
      )
      .mockResolvedValue([])
    const view = mount(TokenDialogs, {
      props: { ui, mode: 'share', connectionId: ui.rows.value[0].id },
      global: { stubs: { Modal: modalStub } },
    })
    await flushPromises()
    if (change === 'close') view.findComponent(Modal).vm.$emit('close')
    else if (change === 'scope') view.findComponent(Dropdown).vm.$emit('update:model-value', '1')
    else await view.setProps({ connectionId: ui.rows.value[1].id })
    await flushPromises()
    answer([
      {
        id: 'late',
        label: 'Late access response',
        scope: { kind: 'folder', id: 'root', path: '/' },
        issued_by_token_id: 'root',
        created_at: '2025-01-01',
        revoked_at: null,
      },
    ])
    await flushPromises()
    expect(view.text()).not.toContain('Late access response')
    view.unmount()
  }
)
it('shows vault inspection progress in its connection row and keeps sync blocked', () => {
  const ui = tokenUiFixture()
  const id = ui.rows.value[0].id
  ui.activity.value = { ...ui.activity.value, [id]: { inspection: { completed: 12, total: 3000 } } }
  const view = mount(SyncSettings, { props: { model: ui } })
  expect(view.text()).toContain('Checking the vault… 12/3000')
  const sync = view
    .findAllComponents(Icon)
    .find((one) => one.props('tooltip') === 'Sync this connection now')!
  expect(sync.props('disabled')).toBe(true)
  view.unmount()
})
it('allows Close during a slow vault check and cancels enrollment', async () => {
  const data = new Map<string, unknown>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  const transport = vi.fn<typeof fetch>()
  const ui = new TokenUi(registry, { get: () => null, set: () => {}, remove: () => {} }, transport)
  let release!: () => void
  ui.connectionChangeGuard = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  try {
    await view.find('input:not([type=file])').setValue(sampleIssuedToken)
    await view
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Connect')!
      .trigger('click')
    await flushPromises()
    const close = view.findAllComponents(Button).find((one) => one.props('text') === 'Close')!
    expect(close.props('disabled')).toBeFalsy()
    await close.trigger('click')
    expect(view.emitted('close')).toHaveLength(1)
    release()
    await flushPromises()
    expect(transport).not.toHaveBeenCalled()
    expect(registry.records()).toEqual([])
  } finally {
    view.unmount()
  }
})
it('ends an unreachable connection attempt with a visible error and ignores its late answer', async () => {
  vi.useFakeTimers()
  const data = new Map<string, unknown>(),
    keys = new Map<string, string>()
  let answer!: (response: Response) => void
  const transport = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve
      })
  )
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => data.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      data.set(key, value)
    },
  })
  const ui = new TokenUi(
    registry,
    {
      get: (key) => keys.get(key) ?? null,
      set: (key, value) => {
        keys.set(key, value)
      },
      remove: (key) => {
        keys.delete(key)
      },
    },
    transport
  )
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  try {
    await view.find('input:not([type=file])').setValue(sampleIssuedToken)
    const button = view.findAllComponents(Button).find((one) => one.props('text') === 'Connect')!
    await button.trigger('click')
    await flushPromises()
    expect(button.props('disabled')).toBe(true)
    expect(
      view
        .findAllComponents(Button)
        .find((one) => one.props('text') === 'Close')!
        .props('disabled')
    ).toBeFalsy()
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('not reachable')
    expect(button.props('disabled')).toBe(false)
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true)
    answer(
      Response.json({
        protocol: 2,
        token_id: 'late-token',
        space_id: 'late-space',
        scope: { kind: 'folder', id: 'root', path: '/' },
        status: 'active',
        limits: { max_file_bytes: 1000, quota_bytes: null },
      })
    )
    await flushPromises()
    expect(registry.records()).toEqual([])
    expect(keys.size).toBe(0)
    expect(view.emitted('close')).toBeUndefined()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})
it('reports a failed review refresh without leaving an unhandled settings promise', async () => {
  const ui = tokenUiFixture(),
    before = Notice.shown.length
  vi.spyOn(ui, 'refreshReviews').mockRejectedValue(new Error('sample closed review store'))
  const view = mount(SyncSettings, { props: { model: ui } })
  await flushPromises()
  expect(Notice.shown.slice(before).join(' ')).toContain('Incoming changes')
  view.unmount()
})

it('connects with only a token and shows a plain failure without closing the dialog', async () => {
  const data = new Map<string, unknown>()
  const ui = new TokenUi(
    TokenConnectionRegistry.open({
      loadLocalStorage: (key) => data.get(key) ?? null,
      saveLocalStorage: (key, value) => {
        data.set(key, value)
      },
    }),
    { get: () => null, set: () => {}, remove: () => {} },
    async () => {
      throw new Error('No request expected')
    }
  )
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: {
      stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } },
    },
  })
  expect(view.findAll('input:not([type=file])')).toHaveLength(1)
  expect(view.text()).not.toContain('Password')
  await view.find('input:not([type=file])').setValue('bad')
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Connect')!
    .trigger('click')
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toContain('damaged')
  expect(view.emitted('close')).toBeUndefined()
})

it('uses the same explicit Connect action for a scanned token', async () => {
  const ui = tokenUiFixture(true),
    connect = vi.spyOn(ui, 'connect').mockResolvedValue()
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: modalStub } },
  })
  view.findComponent(TokenQrReader).vm.$emit('token', sampleIssuedToken)
  await flushPromises()
  expect(view.text()).toContain('https://sync.example')
  expect(view.text()).toContain('Whole vault')
  expect(view.text()).not.toContain('Folder: /')
  expect(connect).not.toHaveBeenCalled()
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Connect')!
    .trigger('click')
  await flushPromises()
  expect(connect).toHaveBeenCalledWith(sampleIssuedToken, expect.any(AbortSignal))
})

it('shows every connection as one row and opens its window with progress, refusals and the conflict copy', async () => {
  const ui = tokenUiFixture(),
    view = mount(SyncSettings, {
      props: { model: ui },
      global: { stubs: { Modal: modalStub, SelectiveSync: true } },
    })
  const rows = view.findAll('.abele-sync-row')
  expect(rows).toHaveLength(3)
  expect(rows[0].text()).toContain('sync.example')
  expect(rows[0].text()).toContain('820 of 2500 files')
  expect(rows[1].text()).toContain('unavailable.example')
  expect(rows[1].text()).toContain('Server unavailable, retrying')
  expect(rows[2].text()).toContain('collaboration.example')
  expect(view.text()).toContain('Group: Sample research group with a deliberately long name')
  expect(view.text()).not.toContain('deliberately long name.md')
  await rows[0].trigger('click')
  await flushPromises()
  expect(view.text()).toContain('server is full')
  expect(view.text()).toContain('Conflict copies')
  expect(view.text()).toContain('Sample note (Conflicted copy sample-device).md')
})

it('shows what waits for a decision above the connections only while something waits', () => {
  const ui = tokenUiFixture(),
    view = mount(SyncSettings, { props: { model: ui } })
  expect(view.findAll('h3')[0].text()).toBe('Waiting for you')
  ui.candidates.value = []
  ui.questions.value = []
  return flushPromises().then(() => {
    expect(view.text()).not.toContain('Waiting for you')
  })
})

it('approves only the immutable code candidate displayed while a later version remains pending', async () => {
  const fixture = tokenUiFixture(),
    state = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(state),
    attachments: new AttachmentConsent(state),
    close: () => {},
  }
  const ui = new TokenUi(
    fixture.registry,
    { get: () => 'a'.repeat(43), set: () => {}, remove: () => {} },
    async () => {
      throw new Error('No request expected')
    },
    reviews
  )
  const source = fixture.candidates.value[0].source,
    bytes = new TextEncoder().encode('sample reviewed version')
  const incoming = {
    source,
    fileId: 'file-a',
    versionId: 'version-a',
    path: 'Scripts/sample.js',
    previousPath: null,
    operation: 'modify' as const,
    directory: false,
    receivedAt: 200,
    mtime: 100,
    sha: await sha256(bytes),
    bytes,
  }
  await reviews.executables.stage(incoming)
  const [candidate] = await reviews.executables.pending(),
    apply = vi.fn(async () => {})
  ui.bind(source.id, {
    apply,
    sync: async () => {},
    pause: async () => {},
    disconnect: async () => {},
    resolve: async () => null,
    opened: async () => [],
  })
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: { stubs: { Modal: modalStub } },
  })
  expect(view.get('pre').text()).toBe('sample reviewed version')
  const later = new TextEncoder().encode('later unreviewed version')
  await reviews.executables.stage({
    ...incoming,
    versionId: 'version-b',
    bytes: later,
    sha: await sha256(later),
  })
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Approve')!
    .trigger('click')
  await vi.waitFor(() => expect(view.emitted('close')).toBeDefined())
  expect(apply).toHaveBeenCalledExactlyOnceWith({ ...candidate, status: 'applying' })
  expect((await reviews.executables.pending()).map((one) => one.versionId)).toEqual(['version-b'])
})

it('rejects only the displayed executable candidate, leaving local code and a later candidate untouched', async () => {
  const ui = tokenUiFixture(),
    candidate = ui.candidates.value[0],
    reject = vi.spyOn(ui, 'reject').mockResolvedValue(),
    approve = vi.spyOn(ui, 'approve')
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: { stubs: { Modal: modalStub } },
  })
  await view
    .findAllComponents(Button)
    .find((one) => one.props('text') === 'Reject')!
    .trigger('click')
  await flushPromises()
  expect(reject).toHaveBeenCalledExactlyOnceWith(candidate)
  expect(approve).not.toHaveBeenCalled()
})
it('closing executable review decides nothing and leaves it available for later', async () => {
  const ui = tokenUiFixture(),
    candidate = ui.candidates.value[0],
    reject = vi.spyOn(ui, 'reject'),
    approve = vi.spyOn(ui, 'approve')
  const view = mount(TokenDialogs, {
    props: { ui, mode: 'review', candidate },
    global: { stubs: { Modal: modalStub } },
  })
  view.findComponent(Modal).vm.$emit('close')
  expect(view.emitted('close')).toHaveLength(1)
  expect(reject).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
  expect(ui.candidates.value).toContain(candidate)
})
