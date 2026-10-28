import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerBinding, DebuggerService } from '@/debugger/DebuggerService'
import DebuggerView from '@/debugger/DebuggerView.vue'
import type { NodeConnection } from '@/node/NodeService'
import { debuggerStatus } from '../fixtures/debugger'
import { useVault } from '../helpers/testEnv'

it.each([
  { outcome: 'survived', observed: false },
  { outcome: 'gone', observed: false },
  { outcome: 'survived', observed: true },
  { outcome: 'gone', observed: true },
])(
  'the stale timestamp refresh recovers $outcome, retained snapshot: $observed, on an already connected node',
  async ({ outcome, observed }) => {
    useVault([])
    DebuggerService.instance.destroy()
    let reads = 0
    const rpc = vi.fn(async (method: string) => {
      if (method === 'debugger.v1.status') {
        if (++reads === 1 && !observed)
          throw new Error('Sample connection interrupted before the status reply')
        if (reads > 1 && outcome === 'gone')
          throw Object.assign(new Error('not_found'), { code: 'not_found' })
        return debuggerStatus()
      }
      if (method === 'debugger.v1.wait') return new Promise(() => {})
      if (method === 'debugger.v1.cancelWait') return { cancelled: true }
      throw new Error('Unexpected sample RPC')
    })
    const connect = vi.fn(async () => {})
    const binding = new DebuggerBinding(
      {
        state: ref('connected'),
        connect,
        client: { request: rpc, debugger: new DebuggerClient(rpc) },
      } as unknown as NodeConnection,
      'sample-chat',
      'sample-node'
    )
    vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
    DebuggerService.instance.select(binding)
    const view = mount(DebuggerView)
    try {
      await binding.open('sample-debug')
      // A restored panel can have a pending identity without a successful current snapshot.
      // The node is back already, so connect deliberately makes no state transition.
      expect(!!binding.sessionId).toBe(observed)
      binding.controller.disconnected()
      binding.controller.session.program = 'sample.js · pid 1234'
      binding.controller.session.seen = 'Today, 10:00'
      ++binding.revision.value
      await nextTick()
      expect(view.text()).toContain('Today, 10:00')
      await view.get('.abele-debug-panel__notice [aria-label="Try to reconnect"]').trigger('click')
      await flushPromises()
      expect(connect).toHaveBeenCalledTimes(1)
      expect(reads).toBe(2)
      expect(view.find('.abele-debug-panel_lost').exists()).toBe(false)
      if (outcome === 'survived') {
        expect(binding.controller.current).toBe(true)
        expect(view.find('.abele-debug-panel_paused').exists()).toBe(true)
      } else {
        expect(view.text()).toContain('Debug session ended. Start a new run.')
        expect(view.find('[aria-label="Start a new run"]').exists()).toBe(true)
      }
    } finally {
      view.unmount()
      binding.destroy()
      DebuggerService.instance.destroy()
    }
  }
)

it.each(['survived', 'request-failed', 'adapter-ended', 'missing'] as const)(
  'recovers a stopped observer on a healthy channel: %s',
  async (outcome) => {
    useVault([])
    DebuggerService.instance.destroy()
    const state = ref('connected')
    const healthEpoch = ref(0)
    let reads = 0
    let drop!: (value: unknown) => void
    const rpc = vi.fn(async (method: string, raw: unknown) => {
      if (method === 'debugger.v1.status') {
        ++reads
        if (reads > 1 && outcome === 'missing')
          throw Object.assign(new Error('not_found'), { code: 'not_found' })
        const result = debuggerStatus({
          breakpoints: [
            {
              breakpoint_id: 'sample-log',
              source_id: 'sample-source',
              line: 7,
              log_message: 'Count: {count}',
              condition: 'count > 1',
              enabled: false,
              status: 'verified',
              resolved_line: 7,
              resolved_column: null,
              message: null,
            },
          ],
        })
        if (reads > 1 && outcome === 'adapter-ended') result.snapshot.lifecycle = 'connection-lost'
        return result
      }
      if (method === 'debugger.v1.wait')
        return new Promise((resolve, reject) => {
          drop = (value) =>
            outcome === 'request-failed'
              ? reject(new Error('Sample observation request failed'))
              : resolve({ wait_id: (raw as { wait_id: string }).wait_id, ...(value as object) })
        })
      if (method === 'debugger.v1.cancelWait') return { cancelled: true }
      throw new Error('Unexpected sample RPC')
    })
    const sdk = new DebuggerClient(rpc)
    const binding = new DebuggerBinding(
      { state, healthEpoch, client: { request: rpc, debugger: sdk } } as unknown as NodeConnection,
      'sample-chat',
      'sample-node'
    )
    vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
    DebuggerService.instance.select(binding)
    const rerun = vi.fn(async () => {})
    binding.rerun = rerun
    const view = mount(DebuggerView)
    try {
      await binding.open('sample-debug')
      binding.controller.registerSource('sample-source', 'sample.js')
      const points = binding.retainedBreakpoints.map((point) => ({ ...point }))
      drop({ reason: 'connection_lost', elapsed_ms: 0, snapshot: null })
      await flushPromises()
      expect(binding.controller.session.status).toBe('lost')
      ++healthEpoch.value
      await flushPromises()
      expect(reads).toBe(2)
      expect(binding.retainedBreakpoints).toEqual(points)
      if (outcome === 'survived' || outcome === 'request-failed') {
        expect(binding.controller.current).toBe(true)
        expect(view.find('.abele-debug-panel_paused').exists()).toBe(true)
      } else if (outcome === 'adapter-ended') {
        expect(binding.controller.session.status).toBe('lost')
        expect(view.find('[aria-label="Try to reconnect"]').exists()).toBe(true)
        expect(rerun).not.toHaveBeenCalled()
      } else {
        expect(view.text()).toContain('Debug session ended. Start a new run.')
        expect(view.find('[aria-label="Try to reconnect"]').exists()).toBe(false)
        await view.get('[aria-label="Start a new run"]').trigger('click')
        await flushPromises()
        expect(rerun).toHaveBeenCalledTimes(1)
        ++healthEpoch.value
        await flushPromises()
        expect(reads).toBe(2)
      }
      expect(
        rpc.mock.calls.every(([method]) =>
          ['debugger.v1.status', 'debugger.v1.wait', 'debugger.v1.cancelWait'].includes(method)
        )
      ).toBe(true)
    } finally {
      view.unmount()
      binding.destroy()
      DebuggerService.instance.destroy()
    }
  }
)

it('recovers observation after reconnect only once a fresh debugger snapshot arrives, and retains Retry', async () => {
  useVault([])
  DebuggerService.instance.destroy()
  const state = ref('connected')
  const waits = new Map<string, (value: unknown) => void>()
  let statusReads = 0
  let finishReconnect!: (value: unknown) => void
  const rpc = vi.fn(async (method: string, raw: unknown) => {
    const params = raw as Record<string, string>
    if (method === 'debugger.v1.status') {
      if (++statusReads === 2)
        return new Promise((resolve) => {
          finishReconnect = resolve
        })
      return debuggerStatus()
    }
    if (method === 'debugger.v1.wait')
      return new Promise((resolve) => waits.set(params.wait_id, resolve))
    if (method === 'debugger.v1.cancelWait') {
      waits.get(params.wait_id)?.({
        wait_id: params.wait_id,
        reason: 'cancelled',
        elapsed_ms: 0,
        snapshot: debuggerStatus().snapshot,
      })
      waits.delete(params.wait_id)
      return { cancelled: true }
    }
    throw new Error('Unexpected sample RPC')
  })
  const sdk = new DebuggerClient(rpc)
  const connection = {
    state,
    client: { request: rpc, debugger: sdk },
    connect: async () => {
      state.value = 'connecting'
      sdk.disconnected()
      await nextTick()
      state.value = 'connected'
    },
  } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-node')
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  DebuggerService.instance.select(binding)
  const sidebarRetry = document.createElement('button')
  sidebarRetry.setAttribute('aria-label', 'Try to reconnect')
  sidebarRetry.addEventListener('click', () => void connection.connect())
  document.body.append(sidebarRetry)
  const view = mount(DebuggerView, { attachTo: document.body })
  try {
    await binding.open('sample-debug')
    await flushPromises()
    expect(view.find('.abele-debug-panel_paused').exists()).toBe(true)
    state.value = 'offline'
    sdk.disconnected()
    await nextTick()
    expect(view.find('.abele-debug-panel_lost').exists()).toBe(true)
    // Reconnecting another pane does not certify the debugger's retained observation.
    document.querySelector<HTMLButtonElement>('[aria-label="Try to reconnect"]')!.click()
    await flushPromises()
    expect(view.find('.abele-debug-panel_lost').exists()).toBe(true)
    expect(sdk.current('sample-debug').observation).toBe('last-known')
    expect(statusReads).toBe(2)
    finishReconnect(debuggerStatus())
    await flushPromises()
    expect(view.find('.abele-debug-panel_paused').exists()).toBe(true)
    expect(sdk.current('sample-debug').observation).toBe('current')
    // Explicit Retry also obtains a fresh observation without replaying program controls.
    state.value = 'offline'
    sdk.disconnected()
    await nextTick()
    await view.get('[aria-label="Try to reconnect"]').trigger('click')
    await flushPromises()
    expect(view.find('.abele-debug-panel_paused').exists()).toBe(true)
    expect(sdk.current('sample-debug').observation).toBe('current')
    expect(
      rpc.mock.calls.every(([method]) =>
        ['debugger.v1.status', 'debugger.v1.wait', 'debugger.v1.cancelWait'].includes(method)
      )
    ).toBe(true)
  } finally {
    view.unmount()
    sidebarRetry.remove()
    binding.destroy()
    DebuggerService.instance.destroy()
  }
})
