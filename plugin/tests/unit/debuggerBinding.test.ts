import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerControlMethodSchemas } from '@abele/node-protocol'
import { DebuggerBinding } from '@/debugger/DebuggerService'
import { debuggerStatus } from '../fixtures/debugger'
import type { NodeConnection } from '@/node/NodeService'
it('does not let an abandoned cursor wait disable a newly opened fresh observation', async () => {
  let rejectOld!: (e: Error) => void
  const waits = new Map<string, (v: unknown) => void>()
  let count = 0
  const rpc = vi.fn(async (method: string, raw: unknown) => {
    const p = DebuggerControlMethodSchemas[
      method as keyof typeof DebuggerControlMethodSchemas
    ].parse(raw) as Record<string, unknown>
    if (method === 'debugger.v1.status') return debuggerStatus()
    if (method === 'debugger.v1.wait')
      return new Promise((resolve, reject) => {
        if (++count === 1) rejectOld = reject
        else waits.set(String(p.wait_id), resolve)
      })
    if (method === 'debugger.v1.cancelWait') {
      waits.get(String(p.wait_id))?.({
        wait_id: p.wait_id,
        reason: 'cancelled',
        elapsed_ms: 0,
        snapshot: debuggerStatus().snapshot,
      })
      waits.delete(String(p.wait_id))
      return { cancelled: true }
    }
    throw new Error('Unexpected sample RPC')
  })
  const connection = {
    state: ref('connected'),
    client: { request: rpc, debugger: new DebuggerClient(rpc) },
  } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-registration')
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  try {
    await binding.open('sample-debug')
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf('function'))
    await binding.open('sample-debug')
    rejectOld(new Error('Old sample wait failed'))
    await vi.waitFor(() => expect(count).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(binding.controller.session.status).toBe('paused')
  } finally {
    binding.destroy()
  }
})
