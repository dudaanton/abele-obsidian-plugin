import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import { debuggerSnapshot } from '../fixtures/debugger'
import type { FolderDebugOwner } from '@/debugger/owner'
import { activeTraceContext } from '@/debugger/trace/agentContext'

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
  const removePoint = vi.fn(async () => {})
  orders.trace = {
    projectId: target.projectId,
    rpc: {},
    points: [{ breakpoint_id: 'shared-point' }],
    savePoint,
    removePoint,
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
    expect.objectContaining({ take: ['rate'], when: 'rate > 0' })
  )
  expect(service.pendingBreakpoints(target, 'packages/rates/src/rates.ts')).toEqual([])
  expect(service.active.value).toBe(orders)
})
