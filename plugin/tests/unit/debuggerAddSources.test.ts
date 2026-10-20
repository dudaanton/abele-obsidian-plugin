import { afterEach, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import { DebuggerService, sourceRefusal } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'
import { programFiles } from '@/debugger/programFiles'
import { NodeClient } from '@abele/node-client'
import { nodeAdvertisesMethod } from '@/node/advertisedMethods'

const target = {
  registrationId: 'sample-node',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'workspace' as const,
  id: 'sample-folder',
}
afterEach(() => DebuggerService.instance.destroy())
it('explains declaration files before asking the node to admit them', async () => {
  const { service, request } = fixture()
  expect((await service.admitFile(target, 'lib/sample.d.ts')).message).toMatch(
    /declaration.*no.*code/i
  )
  expect(request).not.toHaveBeenCalled()
})
it.each([
  ['debugger_source_no_map', /source map/i],
  ['debugger_source_changed', /program started/i],
  ['debugger_source_test', /test/i],
  ['debugger_source_declaration', /declaration.*no.*code/i],
  ['debugger_source_generated', /built.*source/i],
])('explains %s in words', (code, words) => {
  expect(sourceRefusal(code).message).toMatch(words)
})
it('rechecks a changed refusal when the file is opened again', async () => {
  const { service, request } = fixture(true, [
    { path: 'lib/helper.ts', code: 'debugger_source_changed' },
  ])
  expect((await service.admitFile(target, 'lib/helper.ts')).message).toMatch(/changed since/i)
  request.mockResolvedValueOnce({
    incarnation: 'sample-incarnation',
    sources: [{ source_id: 'sample-restored', path: 'lib/helper.ts' }],
    refused: [],
  })
  expect((await service.admitFile(target, 'lib/helper.ts')).message).toBe('')
  expect(service.debugFor(target, 'lib/helper.ts')?.sourceId).toBe('sample-restored')
})
it('reads the negotiated welcome from the installed SDK and forgets it on disconnect', async () => {
  const client = new NodeClient({} as never, {} as never)
  expect(nodeAdvertisesMethod(client, 'debugger.v1.addSources')).toBe(false)
  client.attach({
    welcome: { methods: ['debugger.v1.status', 'debugger.v1.addSources'] },
    transport: { close: async () => {} },
  } as never)
  expect(nodeAdvertisesMethod(client, 'debugger.v1.addSources')).toBe(true)
  expect(nodeAdvertisesMethod(client, 'debugger.v1.sampleFutureMethod')).toBe(false)
  await client.disconnect()
  expect(nodeAdvertisesMethod(client, 'debugger.v1.addSources')).toBe(false)
})
function fixture(supported = true, refused: { path: string; code: string }[] = []) {
  const request = vi.fn(async () => ({
    incarnation: 'sample-incarnation',
    sources: refused.length ? [] : [{ source_id: 'sample-added', path: 'lib/helper.ts' }],
    refused,
  }))
  const owner = {
    kind: 'folder-debug',
    target,
    connection: {
      state: ref('connected'),
      client: {
        request,
        channel: {
          channel: {
            welcome: { methods: supported ? ['debugger.v1.addSources'] : ['debugger.v1.status'] },
          },
        },
      },
    },
  } as unknown as FolderDebugOwner
  const service = DebuggerService.instance
  const binding = service.binding(owner)
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({
      debug_session_id: 'sample-session',
      incarnation: 'sample-incarnation',
    }),
  })
  service.trackFolder(owner, 'sample-session', target)
  return { service, binding, request }
}
it('admits a later-opened file once and retains it for restart', async () => {
  const { service, binding, request } = fixture()
  expect((await service.admitFile(target, 'lib/helper.ts')).message).toBe('')
  expect(service.debugFor(target, 'lib/helper.ts')?.sourceId).toBe('sample-added')
  await service.admitFile(target, 'lib/helper.ts')
  expect(request).toHaveBeenCalledExactlyOnceWith('debugger.v1.addSources', {
    operation_id: expect.any(String),
    debug_session_id: 'sample-session',
    sources: ['lib/helper.ts'],
  })
  expect(service.takenFiles(binding)).toContain('lib/helper.ts')
})
it('retries source admission after switching away during the first answer', async () => {
  const { service, binding, request } = fixture()
  service.select(binding)
  let complete!: (value: unknown) => void
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }) as never
  )
  const pending = service.admitFile(target, 'lib/helper.ts')
  const second = service.binding(
    { kind: 'folder-debug', target, connection: binding.connection },
    'sample-second'
  )
  second.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({ debug_session_id: 'sample-second' }),
  })
  service.select(second)
  complete({
    incarnation: 'sample-incarnation',
    sources: [{ source_id: 'sample-old-source', path: 'lib/helper.ts' }],
    refused: [],
  })
  await pending
  service.select(binding)
  await service.admitFile(target, 'lib/helper.ts')
  expect(request).toHaveBeenCalledTimes(2)
  expect(service.debugFor(target, 'lib/helper.ts')?.sourceId).toBe('sample-added')
})
it('explains an old node without sending an unsupported RPC', async () => {
  const { service, request } = fixture(false)
  expect((await service.admitFile(target, 'lib/helper.ts')).message).toMatch(/update.*node/i)
  expect(request).not.toHaveBeenCalled()
})
it.each([
  ['debugger_source_no_map', /build with source maps/i],
  ['debugger_source_changed', /changed since/i],
  ['debugger_source_outside_folder', /outside.*folder/i],
  ['debugger_source_conflict', /conflict/i],
  ['debugger_source_limit', /limit/i],
  ['debugger_source_unavailable', /unavailable/i],
] as const)('explains refusal %s', async (code, reason) => {
  const { service } = fixture(true, [{ path: 'lib/helper.ts', code }])
  expect((await service.admitFile(target, 'lib/helper.ts')).message).toMatch(reason)
  expect(service.debugFor(target, 'lib/helper.ts')).toBeUndefined()
})

it('ignores an admission answer from the previous session incarnation', async () => {
  const { service, binding, request } = fixture()
  let complete!: (value: unknown) => void
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }) as never
  )
  const pending = service.admitFile(target, 'lib/helper.ts')
  await flushPromises()
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({
      debug_session_id: 'sample-session',
      incarnation: 'sample-new-incarnation',
    }),
  })
  complete({
    incarnation: 'sample-incarnation',
    sources: [{ source_id: 'sample-old-source', path: 'lib/helper.ts' }],
    refused: [],
  })
  await pending
  expect(service.debugFor(target, 'lib/helper.ts')).toBeUndefined()
})

it('does not admit a file from another folder', async () => {
  const { service, request } = fixture()
  expect(
    (await service.admitFile({ ...target, id: 'sample-other-folder' }, 'lib/helper.ts')).message
  ).toBe('')
  expect(request).not.toHaveBeenCalled()
})

it.each([undefined, null])(
  'leaves panes without a target outside folder source lookup (%s)',
  (missing) => {
    const { service } = fixture()
    service.registerSource(
      target.registrationId,
      'sample-chat',
      'sample-source',
      'lib/helper.ts',
      'sample-session',
      'sample-incarnation',
      target
    )
    expect(service.debugFor(missing, 'lib/helper.ts')).toBeUndefined()
    expect(service.folderBinding(missing)).toBeUndefined()
  }
)

it('lists folder entries through the node, follows pages, and offers open files first', async () => {
  const search = vi
    .fn()
    .mockResolvedValueOnce({ entries: [{ path: 'src/entry.ts' }], cursor: 'sample-next' })
    .mockResolvedValueOnce({
      entries: [{ path: 'lib/start.js' }, { path: 'readme.md' }],
      cursor: null,
    })
  const paths = await programFiles({ nodePath: { search } } as never, target, ['lib/start.js'])
  expect(paths).toEqual(['lib/start.js', 'src/entry.ts'])
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ workspace_id: target.id, mode: 'filename', cursor: 'sample-next' })
  )
})

it('gives an already-open tab its margin when its folder session appears', async () => {
  const mode = ref('split')
  const wrapper = mount(NodePathFilePane, {
    props: {
      model: {
        document: ref({ target, path: 'lib/helper.ts', text: 'const sample = 1' }),
        mode,
        busy: ref(false),
        error: ref(''),
      } as never,
    },
    global: { stubs: { FileView: true, NodePathDebugFile: true } },
  })
  expect(wrapper.findComponent({ name: 'NodePathDebugFile' }).exists()).toBe(false)
  fixture()
  await flushPromises()
  await nextTick()
  expect(wrapper.findComponent({ name: 'NodePathDebugFile' }).exists()).toBe(true)
  expect(mode.value).toBe('file')
  wrapper.unmount()
})

it('shows a muted source-map refusal in the file tab', async () => {
  fixture(true, [{ path: 'lib/helper.ts', code: 'debugger_source_no_map' }])
  const wrapper = mount(NodePathFilePane, {
    props: {
      model: {
        document: ref({ target, path: 'lib/helper.ts', text: 'const sample = 1' }),
        mode: ref('file'),
        busy: ref(false),
        error: ref(''),
      } as never,
    },
    global: { stubs: { FileView: true, NodePathDebugFile: true } },
  })
  await flushPromises()
  expect(wrapper.find('[role="status"]').text()).toMatch(/build with source maps/i)
  expect(wrapper.findComponent({ name: 'NodePathDebugFile' }).exists()).toBe(false)
  wrapper.unmount()
})

it('keeps an unknown refusal code in the tooltip', async () => {
  fixture(true, [{ path: 'lib/helper.ts', code: 'debugger_sample_future_refusal' }])
  const wrapper = mount(NodePathFilePane, {
    props: {
      model: {
        document: ref({ target, path: 'lib/helper.ts', text: 'const sample = 1' }),
        mode: ref('file'),
        busy: ref(false),
        error: ref(''),
      } as never,
    },
    global: { stubs: { FileView: true, NodePathDebugFile: true } },
  })
  await flushPromises()
  expect(wrapper.find('[role="status"]').attributes('title')).toBe('debugger_sample_future_refusal')
  expect(wrapper.find('[role="status"]').text()).toMatch(/could not be admitted/i)
  wrapper.unmount()
})
