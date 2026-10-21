import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerBinding, DebuggerService } from '@/debugger/DebuggerService'
import DebuggerView from '@/debugger/DebuggerView.vue'
import type { NodeConnection } from '@/node/NodeService'
import { debuggerStatus } from '../fixtures/debugger'
import { useVault } from '../helpers/testEnv'

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
