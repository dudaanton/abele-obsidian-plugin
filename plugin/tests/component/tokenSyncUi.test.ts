import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import Button from '@/components/obsidian/Button.vue'
import Modal from '@/components/obsidian/Modal.vue'
import TokenQrReader from '@/components/sync/TokenQrReader.vue'
import { tokenUiFixture, sampleIssuedToken } from '@/testing/tokenUiFixture'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { Notice } from '../mocks/obsidian'

const modalStub = { template: '<div><slot /><slot name="footer" /></div>' }
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
  expect(connect).toHaveBeenCalledWith(sampleIssuedToken)
})

it('shows every connection, last sync, progress, refusals and the conflict copy without hiding an offline server', () => {
  const ui = tokenUiFixture(),
    view = mount(SyncSettings, { props: { model: ui } })
  expect(view.text()).toContain('https://sync.example')
  expect(view.text()).toContain('https://unavailable.example')
  expect(view.text()).toContain('https://collaboration.example')
  expect(view.text()).toContain('Last synced')
  expect(view.text()).toContain('820 of 2500 files')
  expect(view.text()).toContain('server is full')
  expect(view.text()).toContain('Conflict copy saved')
  expect(view.text()).toContain('Group: Sample research group with a deliberately long name')
  expect(view.text()).not.toContain('deliberately long name.md')
  expect(
    view.findAll('h3').some((heading) => heading.text() === 'Whole vault · sync.example')
  ).toBe(true)
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
