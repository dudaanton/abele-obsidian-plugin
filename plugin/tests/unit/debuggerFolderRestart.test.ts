import { afterEach, expect, it, vi } from 'vitest'
import { debuggerSnapshot } from '../fixtures/debugger'
import type { FolderDebugOwner } from '@/debugger/owner'

const f = vi.hoisted(() => ({
  binding: vi.fn(),
  select: vi.fn(),
  reveal: vi.fn(async () => {}),
  register: vi.fn(),
  sources: vi.fn(async () => {}),
  discover: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
  owner: vi.fn(),
  active: { value: null as unknown },
}))
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: {
    instance: {
      binding: f.binding,
      select: f.select,
      discover: f.discover,
      restoreSelection: f.restore,
      active: f.active,
      owner: f.owner,
    },
  },
}))
vi.mock('@/views/revealSidebarView', () => ({ revealSidebarView: f.reveal }))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: {} } }) },
}))
vi.mock('@/debugger/startProgram', async (original) => {
  const real = await original<typeof import('@/debugger/startProgram')>()
  return { ...real, registerSources: f.register, openSources: f.sources }
})
import { DebugView, showSession } from '@/debugger/register'

afterEach(() => vi.clearAllMocks())

function fixture(lifecycle: 'terminated' | 'detached' | 'failed' | 'connection-lost') {
  const snapshots = new Map(
    ['sample-ended', 'sample-second', 'sample-third'].map((id, index) => [
      id,
      debuggerSnapshot({
        debug_session_id: id,
        incarnation: `sample-incarnation-${index}`,
        lifecycle,
        execution: 'unknown',
      }),
    ])
  )
  const controller = {
    snapshot: snapshots.get('sample-ended')!,
    current: true,
    observe: vi.fn(),
    command: vi.fn(async () => {}),
    setBreakpoint: vi.fn(async () => {}),
  }
  const binding = {
    controller,
    open: vi.fn(async (id: string) => {
      controller.snapshot = snapshots.get(id)!
    }),
    rerun: undefined as undefined | (() => Promise<unknown>),
    reattach: undefined as undefined | (() => Promise<unknown>),
    retainedBreakpoints: [] as { file: string; requestedLine: number; condition?: string }[],
  }
  f.binding.mockReturnValue(binding)
  f.register.mockImplementation(async (_owner, result) => snapshots.get(result.debug_session_id))
  const request = vi.fn(
    async (_method: string, params: { operation_id: string; debug_session_id: string }) => ({
      debug_session_id:
        params.debug_session_id === 'sample-ended' ? 'sample-second' : 'sample-third',
      sources: [{ source_id: 'sample-source', path: 'sample.cjs' }],
    })
  )
  const context = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      projectId: 'sample-project',
      kind: 'workspace',
      id: 'sample-workspace',
    },
    connection: {
      client: {
        request,
        debugger: {
          status: vi.fn(async (id: string) => ({ snapshot: snapshots.get(id)! })),
          current: vi.fn((id: string) => ({
            observation: 'current',
            snapshot: snapshots.get(id)!,
          })),
        },
      },
    },
  } as unknown as FolderDebugOwner
  return { context, binding, request }
}

it('carries retained points through an explicit re-attach using the node recipe', async () => {
  const { context, binding } = fixture('detached')
  binding.controller.snapshot.target.process_ownership = 'external'
  binding.retainedBreakpoints = [{ file: 'sample.cjs', requestedLine: 5, condition: 'count > 2' }]
  await showSession(context, 'sample-ended')
  await binding.reattach!()
  expect(binding.controller.setBreakpoint).toHaveBeenCalledWith(
    expect.any(String),
    'sample-source',
    5,
    'count > 2'
  )
})

it.each(['owned', 'external'] as const)(
  'restores explicit controls for a retained %s session without restarting it',
  async (ownership) => {
    const { context, binding, request } = fixture('detached')
    binding.controller.snapshot.target.process_ownership = ownership
    f.active.value = binding
    f.owner.mockReturnValue(context)
    const view = new DebugView({} as never)
    await view.setState({}, {} as never)
    expect(ownership === 'owned' ? binding.rerun : binding.reattach).toBeTypeOf('function')
    expect(request).not.toHaveBeenCalled()
  }
)

it.each(['terminated', 'detached', 'failed', 'connection-lost'] as const)(
  'restarts a %s folder session through the retained node recipe, then uses the new session',
  async (lifecycle) => {
    const { context, binding, request } = fixture(lifecycle)
    await showSession(context, 'sample-ended')
    await binding.rerun!()
    expect(request).toHaveBeenCalledExactlyOnceWith('debugger.v1.restart', {
      operation_id: expect.any(String),
      debug_session_id: 'sample-ended',
    })
    expect(binding.open).toHaveBeenLastCalledWith('sample-second')
    expect(f.sources).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({ debug_session_id: 'sample-second' }),
      'sample-incarnation-1',
      context.target
    )
    // A terminal observation from the node is retained, never turned into an automatic relaunch.
    expect(binding.controller.snapshot.lifecycle).toBe(lifecycle)
    expect(binding.controller.command).not.toHaveBeenCalled()
    await binding.rerun!()
    expect(request).toHaveBeenLastCalledWith('debugger.v1.restart', {
      operation_id: expect.any(String),
      debug_session_id: 'sample-second',
    })
    expect(request.mock.calls[0][1].operation_id).not.toBe(request.mock.calls[1][1].operation_id)
    expect(binding.open).toHaveBeenLastCalledWith('sample-third')
    expect(request).toHaveBeenCalledTimes(2)
  }
)
