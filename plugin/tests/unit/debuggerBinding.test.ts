import { expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerControlMethodSchemas } from '@abele/node-protocol'
import { DebuggerBinding, DebuggerService } from '@/debugger/DebuggerService'
import { GlobalStore } from '@/stores/GlobalStore'
import { Platform } from 'obsidian'
import { debuggerStatus } from '../fixtures/debugger'
import type { NodeConnection } from '@/node/NodeService'
it('clears an old read failure only after opening a fresh debugger snapshot', async () => {
  const rpc = vi.fn(async (method: string, params: any) => {
    if (method === 'debugger.v1.status') return debuggerStatus()
    if (method === 'debugger.v1.wait')
      return {
        wait_id: params.wait_id,
        reason: 'cancelled',
        elapsed_ms: 0,
        snapshot: debuggerStatus().snapshot,
      }
    throw new Error('Unexpected sample RPC')
  })
  const binding = new DebuggerBinding(
    {
      state: ref('connected'),
      client: {
        request: rpc,
        debugger: new DebuggerClient(rpc),
      },
    } as unknown as NodeConnection,
    'sample-chat',
    'sample-node'
  )
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  binding.controller.error = 'request_timeout'
  try {
    await binding.open('sample-debug')
    expect(binding.controller.current).toBe(true)
    expect(binding.controller.error).toBe('')
  } finally {
    binding.destroy()
  }
})
it('resumes observation after reconnecting without replaying program controls', async () => {
  const state = ref('connected')
  const binding = new DebuggerBinding(
    { state } as unknown as NodeConnection,
    'sample-chat',
    'sample-node'
  )
  binding.controller.observe({ observation: 'current', snapshot: debuggerStatus().snapshot })
  const open = vi.spyOn(binding, 'open').mockResolvedValue(undefined)
  try {
    state.value = 'disconnected'
    await nextTick()
    state.value = 'connected'
    await nextTick()
    expect(open).toHaveBeenCalledWith(binding.sessionId)
  } finally {
    binding.destroy()
  }
})
it('keeps a session request failure distinct from a lost node connection', () => {
  const connection = { state: ref('connected') } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-registration')
  try {
    binding.controller.observe({ observation: 'current', snapshot: debuggerStatus().snapshot })
    binding.fail(new Error('Cannot resolve sample module'))
    expect(binding.controller.session.status).toBe('paused')
    expect(binding.controller.error).toBe('Cannot resolve sample module')
  } finally {
    binding.destroy()
  }
})

it.each([
  [true, true, false],
  [true, false, true],
  [false, true, true],
])(
  'preserves request focus only on the same phone project (%s, %s)',
  async (phone, sameProject, reveals) => {
    const binding = new DebuggerBinding(
      { state: ref('connected'), client: {} } as unknown as NodeConnection,
      'sample-chat',
      'sample-registration'
    )
    binding.controller.observe({ observation: 'current', snapshot: debuggerStatus().snapshot })
    binding.controller.session.status = 'paused'
    vi.spyOn(binding.controller, 'refreshApprovals').mockResolvedValue(undefined)
    vi.spyOn(binding.controller, 'refreshHistory').mockResolvedValue(undefined)
    vi.spyOn(binding.controller, 'refreshOutput').mockResolvedValue(undefined)
    vi.spyOn(binding.controller, 'loadStack').mockImplementation(async () => {
      binding.controller.session.frames = [{ name: 'sample', file: 'sample.ts', line: 12 }]
    })
    const reveal = vi.spyOn(DebuggerService.instance, 'reveal').mockImplementation(() => {})
    const store = GlobalStore.getInstance() as unknown as { _app: unknown }
    const previous = store._app
    store._app = {
      workspace: {
        getActiveViewOfType: () => ({
          getViewType: () => 'abele-request',
          getState: () => ({
            registrationId: 'sample-registration',
            projectId: sameProject
              ? binding.controller.snapshot!.target.project_id
              : 'other-project',
          }),
        }),
      },
    }
    Platform.isPhone = phone
    // Only the session the panel shows moves the editor.
    DebuggerService.instance.active.value = binding
    try {
      await binding.refresh()
      expect(reveal).toHaveBeenCalledTimes(reveals ? 1 : 0)
    } finally {
      Platform.isPhone = false
      DebuggerService.instance.active.value = null
      store._app = previous
      binding.destroy()
      vi.restoreAllMocks()
    }
  }
)
it('shows a native launch that terminates before its first stop without replaying any effect', async () => {
  const starting = debuggerStatus({
    lifecycle: 'configuring',
    execution: 'unknown',
    threads: [],
    selected_thread_id: null,
    thread_inventory: 'unknown',
    all_threads_status: 'unknown',
    event_seq: 1,
  })
  const active = debuggerStatus({
    execution: 'unknown',
    threads: [],
    selected_thread_id: null,
    thread_inventory: 'unknown',
    all_threads_status: 'unknown',
    event_seq: 3,
  })
  const ended = debuggerStatus({
    lifecycle: 'terminated',
    execution: 'unknown',
    threads: [],
    selected_thread_id: null,
    thread_inventory: 'unknown',
    all_threads_status: 'unknown',
    event_seq: 7,
  })
  let waits = 0
  const rpc = vi.fn(async (method: string, raw: unknown) => {
    if (method === 'debugger.v1.status') return starting
    if (method === 'debugger.v1.wait')
      return {
        wait_id: (raw as { wait_id: string }).wait_id,
        reason: ++waits === 1 ? 'event' : 'cancelled',
        elapsed_ms: 0,
        snapshot: waits === 1 ? active.snapshot : ended.snapshot,
      }
    throw new Error('Unexpected sample RPC')
  })
  const connection = {
    state: ref('connected'),
    client: { request: rpc, debugger: new DebuggerClient(rpc) },
  } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-folder', 'sample-registration')
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  try {
    await binding.open('sample-debug')
    await vi.waitFor(() => expect(binding.controller.session.status).toBe('exited'))
    expect(binding.controller.snapshot?.event_seq).toBe(7)
    expect(binding.controller.error).toBe('')
    expect(rpc.mock.calls.map(([method]) => method)).toEqual([
      'debugger.v1.status',
      'debugger.v1.wait',
      'debugger.v1.wait',
    ])
  } finally {
    binding.destroy()
  }
})
it('reads retained terminal output when the node cancels a wait on program exit', async () => {
  const terminal = structuredClone(debuggerStatus().snapshot)
  terminal.lifecycle = 'terminated'
  terminal.execution = 'unknown'
  terminal.threads = []
  terminal.selected_thread_id = null
  const rpc = vi.fn(async (method: string, raw: unknown) => {
    if (method === 'debugger.v1.status') return debuggerStatus()
    if (method === 'debugger.v1.wait')
      return {
        wait_id: (raw as { wait_id: string }).wait_id,
        reason: 'cancelled',
        elapsed_ms: 0,
        snapshot: terminal,
      }
    throw new Error('Unexpected sample RPC')
  })
  const connection = {
    state: ref('connected'),
    client: { request: rpc, debugger: new DebuggerClient(rpc) },
  } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-registration')
  const refresh = vi.spyOn(binding, 'refresh').mockImplementation(async () => {
    if (binding.controller.session.status === 'exited')
      binding.controller.session.output = 'Synthetic failure at sample.cjs:7'
  })
  try {
    await binding.open('sample-debug')
    await vi.waitFor(() => expect(binding.controller.session.status).toBe('exited'))
    expect(binding.controller.session.output).toContain('Synthetic failure at sample.cjs:7')
    expect(refresh).toHaveBeenCalledTimes(2)
  } finally {
    binding.destroy()
  }
})
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
