import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import { debuggerSnapshot } from '../fixtures/debugger'
import type { FolderDebugOwner } from '@/debugger/owner'
import { activeTraceContext } from '@/debugger/trace/agentContext'
import { TraceSession } from '@/debugger/trace/TraceSession'
import { TraceRpc, type WirePoint } from '@/debugger/trace/wire'
import { createTraceTools } from '@/ai/tools/TraceTools'

vi.mock('@/ai/tools/node/projectAccess', () => ({ nodeProjectGuard: vi.fn(async () => () => {}) }))

const service = new DebuggerService()
const target = {
  registrationId: 'sample-registration',
  nodeId: 'sample-node',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
const owner = {
  kind: 'folder-debug',
  target,
  connection: { state: ref('connected') },
} as unknown as FolderDebugOwner
function session(id: string, entry: string, pid: number) {
  const binding = service.binding(owner, id)
  const snapshot = debuggerSnapshot({ debug_session_id: id })
  snapshot.target.launch_configuration_id = `${entry} · pid ${pid}`
  binding.controller.observe({ observation: 'current', snapshot })
  service.registerSource(
    binding.registrationId,
    binding.conversationId,
    `${id}-source`,
    entry,
    id,
    snapshot.incarnation,
    target
  )
  return binding
}
afterEach(() => {
  service.destroy()
  DebuggerService.instance.destroy()
  vi.restoreAllMocks()
})

it('keeps a mapped shared package source with its process for person points', () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  service.registerSource(
    orders.registrationId,
    orders.conversationId,
    'shared',
    'packages/common/money.ts',
    orders.sessionId!,
    orders.controller.snapshot!.incarnation,
    target
  )
  expect(service.fileBinding(target, 'packages/common/money.ts')).toBe(orders)
  expect(service.debugFor(target, 'packages/common/money.ts')?.sourceId).toBe('shared')
})

it.each([
  { copies: 1, refused: false },
  { copies: 2, refused: false },
  { copies: 1, refused: true },
  { copies: 1, refused: false, canonical: true },
  { copies: 2, refused: false, orphan: true },
])(
  'removes the pending then attached sibling point: copies=$copies retained=$refused canonical=$canonical orphan=$orphan',
  async ({ copies, refused, canonical, orphan }) => {
    const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
    const file = 'packages/rates/src/index.ts'
    service.editPendingPoint(target, file, 7, { record: { take: ['rate'] } })
    const rates = session('sample-rates', file, 102)
    const saved = new Map<string, WirePoint[]>()
    const request = vi.fn(async (method: string, p: any) => {
      const id = p.debug_session_id
      if (method === 'trace.v1.points.set') {
        saved.set(id, [
          ...(saved.get(id) ?? []).filter(
            (point) =>
              (refused || !p.remove.includes(point.breakpoint_id)) &&
              !p.upsert.some((next: WirePoint) => next.breakpoint_id === point.breakpoint_id)
          ),
          ...p.upsert,
        ])
        return { points: saved.get(id) }
      }
      if (method === 'trace.v1.points.list') return { points: saved.get(id) ?? [] }
      if (method === 'trace.v1.status')
        return { folder: '/sample/runs', chosen: true, recording: null }
      if (method === 'trace.v1.runs') return { folder: '/sample/runs', chosen: true, runs: [] }
      throw Error(method)
    })
    for (const binding of [orders, rates]) {
      binding.trace = new TraceSession(new TraceRpc(request), binding.controller, () => {})
      let first = true
      vi.spyOn(binding.controller, 'setBreakpoint').mockImplementation(
        async (id, sourceId, line) => {
          const mapped = canonical && binding === rates ? 'sample-runtime-source' : sourceId
          binding.controller.registerSource(
            mapped,
            binding === rates ? file : 'packages/orders/src/index.ts'
          )
          binding.controller.observe({
            observation: 'current',
            snapshot: debuggerSnapshot({
              ...binding.controller.snapshot,
              state_revision: binding.controller.snapshot!.state_revision + 1,
              breakpoints: [
                {
                  breakpoint_id: id,
                  source_id: mapped,
                  line,
                  resolved_line: line,
                  resolved_column: null,
                  message: null,
                  status: 'verified',
                },
              ],
            }),
          })
          const pending = canonical && binding === rates && first
          first = false
          return { outcome: pending ? 'pending' : 'completed' } as never
        }
      )
      vi.spyOn(binding.controller, 'removeBreakpoint').mockImplementation(async (id) => {
        binding.controller.observe({
          observation: 'current',
          snapshot: debuggerSnapshot({
            ...binding.controller.snapshot,
            state_revision: binding.controller.snapshot!.state_revision + 1,
            breakpoints: binding.controller.snapshot!.breakpoints.filter(
              (point) => point.breakpoint_id !== id
            ),
          }),
        })
        return { outcome: 'completed' } as never
      })
    }
    await service.admitFile(target, file)
    if (canonical) {
      expect(service.pendingBreakpoints(target, file)).toEqual([7])
      // An unconfirmed application is retried after the adapter publishes its source identity.
      await service.admitFile(target, file)
    }
    expect(service.pendingBreakpoints(target, file)).toEqual([])
    expect(rates.trace!.points).toHaveLength(1)
    if (orphan) {
      // A new adapter source replaces the breakpoint inventory; the old trace registration
      // still exists on the node even though it is no longer a known debugger breakpoint.
      await rates.trace!.savePoint('sample-new-source', 7, { take: ['rate'] })
      expect(rates.controller.knownBreakpoints()).toHaveLength(1)
      expect(rates.trace!.points).toHaveLength(2)
    } else if (copies === 2) {
      const original = rates.controller.snapshot!.breakpoints[0]
      rates.controller.observe({
        observation: 'current',
        snapshot: debuggerSnapshot({
          ...rates.controller.snapshot,
          state_revision: rates.controller.snapshot!.state_revision + 1,
          breakpoints: [original, { ...original, breakpoint_id: 'sample-retained-copy' }],
        }),
      })
      await rates.trace!.rpc.setPoints(
        rates.sessionId!,
        [{ breakpoint_id: 'sample-retained-copy', take: ['rate'] }],
        []
      )
      // The late registration is on the node, but the viewed session's cache has not read it.
      expect(rates.trace!.points).toHaveLength(1)
    }
    const live = DebuggerService.instance
    live.select(rates)
    vi.spyOn(live, 'folder').mockReturnValue(target)
    vi.spyOn(live, 'fileBinding').mockImplementation(service.fileBinding.bind(service))
    vi.spyOn(live, 'sourceFor').mockImplementation(service.sourceFor.bind(service))
    const call = (name: string, params: Record<string, unknown>) =>
      createTraceTools(activeTraceContext)
        .find((tool) => tool.name === name)!
        .execute('sample-call', params)
    await call('trace_point_add', {
      file: 'packages/orders/src/index.ts',
      line: 2,
      take: ['value'],
    })
    await call('trace_point_list', { file: 'packages/orders/src/index.ts' })
    live.select(orders)
    const removing = call('trace_point_remove', { file, line: 7, session: rates.sessionId })
    if (refused) {
      await expect(removing).rejects.toThrow('could not be confirmed')
      expect(rates.trace!.points).toHaveLength(1)
      expect(saved.get(rates.sessionId!)).toHaveLength(1)
      return
    }
    const result = await removing
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('removed') })
    expect(rates.controller.removeBreakpoint).toHaveBeenCalledTimes(copies)
    expect(orders.controller.removeBreakpoint).not.toHaveBeenCalled()
    expect(orders.trace!.points).toHaveLength(1)
    expect(saved.get(orders.sessionId!)).toHaveLength(1)
    expect(rates.trace!.points).toEqual([])
    expect(saved.get(rates.sessionId!)).toEqual([])
  }
)

it('applies a pending point once when several source views admit the same mapped file', async () => {
  const file = 'packages/rates/src/index.ts'
  service.editPendingPoint(target, file, 4, { record: { take: ['rate'] } })
  const rates = session('sample-rates', file, 102)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const set = vi.spyOn(rates.controller, 'setBreakpoint').mockImplementation(async () => {
    await held
    return { outcome: 'completed' } as never
  })
  const savePoint = vi.fn(async () => ({ pending: false }))
  rates.trace = { savePoint, dispose: vi.fn() } as never
  const first = service.admitFile(target, file)
  const second = service.admitFile(target, file)
  release()
  await Promise.all([first, second])
  expect(set).toHaveBeenCalledTimes(1)
  expect(savePoint).toHaveBeenCalledTimes(1)
  expect(service.pendingBreakpoints(target, file)).toEqual([])
})

it('adds, lists and removes an explicit agent point in a mapped shared package', async () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  const file = 'packages/common/money.ts'
  service.registerSource(
    orders.registrationId,
    orders.conversationId,
    'shared',
    file,
    orders.sessionId!,
    orders.controller.snapshot!.incarnation,
    target
  )
  const savePoint = vi.fn(async () => ({ pending: false }))
  const removePoint = vi.fn(async () => {
    orders.trace!.points = []
  })
  orders.trace = {
    projectId: target.projectId,
    rpc: {},
    points: [{ breakpoint_id: 'shared-point' }],
    savePoint,
    removePoint,
    refreshPoints: vi.fn(async () => {}),
    registeredPointIds: vi.fn(() => []),
    dispose: vi.fn(),
  } as never
  vi.spyOn(orders.controller, 'knownBreakpoints').mockReturnValue([
    { id: 'shared-point', sourceId: 'shared', file, line: 4, requestedLine: 4, state: 'set' },
  ] as never)
  const live = DebuggerService.instance
  live.select(orders)
  vi.spyOn(live, 'folder').mockReturnValue(target)
  vi.spyOn(live, 'fileBinding').mockImplementation(service.fileBinding.bind(service))
  vi.spyOn(live, 'sourceFor').mockImplementation(service.sourceFor.bind(service))
  const context = activeTraceContext({ file, session: orders.sessionId })!
  expect(await context.addPoint(file, 4, { take: ['value'] })).toEqual({ recording: true })
  expect(savePoint).toHaveBeenCalledWith('shared', 4, { take: ['value'] })
  expect(await context.listPoints!()).toContain(`${file}:4`)
  await context.removePoint(file, 4)
  expect(removePoint).toHaveBeenCalledWith('shared-point')
})

it('retains explicit session selection for reading runs after a process ended', () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  orders.controller.observe({
    observation: 'current',
    snapshot: { ...orders.controller.snapshot!, lifecycle: 'terminated' },
  })
  orders.controller.session.unavailable = true
  expect(service.fileBinding(target, 'packages/orders/src/index.ts')).toBeUndefined()
  expect(service.fileBinding(target, '', { session: orders.sessionId })).toBe(orders)
})

it('routes a file to its package process independently of the selected session', () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  const rates = session('sample-rates', 'packages/rates/src/index.ts', 102)
  service.select(orders)
  expect(service.fileBinding(target, 'packages/rates/src/rates.ts')).toBe(rates)
  expect(service.debugFor(target, 'packages/rates/src/index.ts')?.debugSessionId).toBe(
    rates.sessionId
  )
  service.select(rates)
  expect(service.fileBinding(target, 'packages/orders/src/client.ts')).toBe(orders)
})

it('keeps a different package pending until its process attaches', () => {
  session('sample-orders', 'packages/orders/src/index.ts', 101)
  service.editPendingPoint(target, 'packages/rates/src/rates.ts', 4, { record: { take: ['rate'] } })
  expect(service.fileBinding(target, 'packages/rates/src/rates.ts')).toBeUndefined()
  expect(service.pendingBreakpoints(target, 'packages/rates/src/rates.ts')).toEqual([4])
  const rates = session('sample-rates', 'packages/rates/src/index.ts', 102)
  expect(service.fileBinding(target, 'packages/rates/src/rates.ts')).toBe(rates)
})

it('requires an explicit process for a shared file and uses it without changing the view', () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  const rates = session('sample-rates', 'packages/rates/src/index.ts', 102)
  for (const b of [orders, rates])
    service.registerSource(
      b.registrationId,
      b.conversationId,
      'shared',
      'packages/common/money.ts',
      b.sessionId!,
      b.controller.snapshot!.incarnation,
      target
    )
  service.select(orders)
  expect(() => service.fileBinding(target, 'packages/common/money.ts')).toThrow(/ambiguous/i)
  expect(service.fileBinding(target, 'packages/common/money.ts', { process: 102 })).toBe(rates)
  expect(service.active.value).toBe(orders)
})

it('formats launched and attached labels as the same package-relative entry', () => {
  const attached = session('sample-orders', 'packages/orders/src/index.ts', 101)
  expect(service.sessionName(attached.controller.snapshot!)).toBe('orders/index.ts · pid 101')
  const launched = session('sample-rates', 'packages/rates/src/index.ts', 102)
  launched.controller.snapshot!.target.launch_configuration_id =
    '/sample/project/packages/rates/src/index.ts'
  expect(service.sessionName(launched.controller.snapshot!)).toBe('rates/index.ts')
})

it('applies pending recording settings only after the matching service attaches', async () => {
  const orders = session('sample-orders', 'packages/orders/src/index.ts', 101)
  service.select(orders)
  const request = vi.fn(async () => ({
    incarnation: 'sample-incarnation',
    sources: [{ source_id: 'rates-source', path: 'packages/rates/src/rates.ts' }],
    refused: [],
  }))
  Object.assign(owner.connection, {
    client: { request, channel: { channel: { welcome: { methods: ['debugger.v1.addSources'] } } } },
  })
  service.editPendingPoint(target, 'packages/rates/src/rates.ts', 4, {
    record: { take: ['rate'] },
    condition: 'rate > 0',
  })
  await service.admitFile(target, 'packages/rates/src/rates.ts')
  expect(request).not.toHaveBeenCalled()
  const rates = session('sample-rates', 'packages/rates/src/index.ts', 102)
  const set = vi
    .spyOn(rates.controller, 'setBreakpoint')
    .mockResolvedValue({ outcome: 'completed' } as never)
  const savePoint = vi.fn(async () => ({ pending: false }))
  rates.trace = { savePoint, dispose: vi.fn() } as never
  await service.admitFile(target, 'packages/rates/src/rates.ts')
  expect(request).toHaveBeenCalledWith(
    'debugger.v1.addSources',
    expect.objectContaining({ debug_session_id: rates.sessionId })
  )
  expect(set).toHaveBeenCalledWith(expect.any(String), 'rates-source', 4, 'rate > 0', {
    enabled: true,
    hit_condition: undefined,
  })
  expect(savePoint).toHaveBeenCalledWith(
    'rates-source',
    4,
    expect.objectContaining({ take: ['rate'], when: 'rate > 0' }),
    set.mock.calls[0][0]
  )
  expect(service.pendingBreakpoints(target, 'packages/rates/src/rates.ts')).toEqual([])
  expect(service.active.value).toBe(orders)
})
