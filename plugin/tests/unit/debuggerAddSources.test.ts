import { afterEach, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'
import { programFiles } from '@/debugger/programFiles'

const target = {
  registrationId: 'sample-node',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'workspace' as const,
  id: 'sample-folder',
}
afterEach(() => DebuggerService.instance.destroy())
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
        describe: async () => ({
          capabilities: {
            capabilities: {
              debugger_v1: { status: 'supported', ...(supported ? { add_sources: true } : {}) },
            },
          },
        }),
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
  expect(await service.admitFile(target, 'lib/helper.ts')).toBe('')
  expect(service.debugFor(target, 'lib/helper.ts')?.sourceId).toBe('sample-added')
  await service.admitFile(target, 'lib/helper.ts')
  expect(request).toHaveBeenCalledExactlyOnceWith('debugger.v1.addSources', {
    operation_id: expect.any(String),
    debug_session_id: 'sample-session',
    sources: ['lib/helper.ts'],
  })
  expect(service.takenFiles(binding)).toContain('lib/helper.ts')
})
it('explains an old node without sending an unsupported RPC', async () => {
  const { service, request } = fixture(false)
  expect(await service.admitFile(target, 'lib/helper.ts')).toMatch(/update.*node/i)
  expect(request).not.toHaveBeenCalled()
})
it.each([
  ['source_map_missing', /build with source maps/i],
  ['source_changed', /changed since/i],
  ['outside_folder', /outside.*folder/i],
] as const)('explains refusal %s', async (code, reason) => {
  const { service } = fixture(true, [{ path: 'lib/helper.ts', code }])
  expect(await service.admitFile(target, 'lib/helper.ts')).toMatch(reason)
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
  expect(await service.admitFile({ ...target, id: 'sample-other-folder' }, 'lib/helper.ts')).toBe(
    ''
  )
  expect(request).not.toHaveBeenCalled()
})

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
  expect(wrapper.findComponent({ name: 'NodePathDebugFile' }).exists()).toBe(false)
  fixture()
  await flushPromises()
  await nextTick()
  expect(wrapper.findComponent({ name: 'NodePathDebugFile' }).exists()).toBe(true)
  wrapper.unmount()
})

it('shows a muted source-map refusal in the file tab', async () => {
  fixture(true, [{ path: 'lib/helper.ts', code: 'source_map_missing' }])
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
