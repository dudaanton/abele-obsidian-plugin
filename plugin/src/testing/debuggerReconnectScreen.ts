import { nextTick, ref } from 'vue'
import { DebuggerClient } from '@abele/node-client'
import { DebuggerSnapshotSchema } from '@abele/node-protocol'
import { DebuggerBinding, DebuggerService } from '@/debugger/DebuggerService'
import type { NodeConnection } from '@/node/NodeService'
import { GlobalStore } from '@/stores/GlobalStore'
import { revealSidebarView } from '@/views/revealSidebarView'

let binding: DebuggerBinding | undefined
let previous: DebuggerBinding | null = null
let reads = 0
let connects = 0
const waits = new Map<string, (value: unknown) => void>()

export async function closeDebuggerReconnectFixture() {
  if (!binding) return
  binding?.destroy()
  binding = undefined
  waits.clear()
  DebuggerService.instance.active.value = previous
  previous = null
  await nextTick()
}

/** Recorded channel lifecycle in the real debugger sidebar; no node or program is started. */
export async function openDebuggerReconnectFixture(outcome: 'survived' | 'gone') {
  await closeDebuggerReconnectFixture()
  previous = DebuggerService.instance.active.value
  reads = connects = 0
  const snapshot = DebuggerSnapshotSchema.parse({
    version: 'debugger.v1',
    debug_session_id: 'sample-refresh-session',
    incarnation: 'sample-incarnation',
    state_revision: 4,
    breakpoint_revision: 0,
    event_seq: 8,
    stop_epoch: 3,
    observed_at: new Date().toISOString(),
    target: {
      node_id: 'sample-node',
      project_id: 'sample-project',
      workspace_id: null,
      worktree_id: 'sample-tree',
      conversation_id: 'sample-chat',
      target_id: 'sample-target',
      adapter_profile: 'sample-js',
      adapter_version: 'sample-version',
      launch_configuration_id: 'sample-app.js · pid 1234',
      process_ownership: 'owned',
      build_identity: 'matched',
    },
    lifecycle: 'active',
    execution: 'stopped',
    threads: [
      {
        thread_id: 1,
        name: 'main',
        status: 'stopped',
        stop: {
          reason: 'breakpoint',
          hit_breakpoint_ids: [],
          location: { source_id: 'sample-source', line: 7 },
        },
      },
    ],
    thread_inventory: 'complete',
    all_threads_status: 'stopped',
    selected_thread_id: 1,
    selected_frame_handle: null,
    breakpoints: [],
    adapter_capabilities: [],
    pending_commands: [],
    pending_approvals: [],
  })
  const request = async (method: string, raw: unknown): Promise<unknown> => {
    const params = raw as { wait_id: string }
    if (method === 'debugger.v1.status') {
      if (++reads > 1 && outcome === 'gone')
        throw Object.assign(new Error('not_found'), { code: 'not_found' })
      return {
        snapshot,
        cursor: {
          debug_session_id: snapshot.debug_session_id,
          incarnation: snapshot.incarnation,
          event_seq: snapshot.event_seq,
        },
      }
    }
    if (method === 'debugger.v1.wait')
      return new Promise((resolve) => waits.set(params.wait_id, resolve))
    if (method === 'debugger.v1.cancelWait') {
      waits.get(params.wait_id)?.({
        wait_id: params.wait_id,
        reason: 'cancelled',
        elapsed_ms: 0,
        snapshot,
      })
      waits.delete(params.wait_id)
      return { cancelled: true }
    }
    throw new Error('Unexpected recorded debugger request')
  }
  const client = new DebuggerClient(request)
  binding = new DebuggerBinding(
    {
      state: ref('connected'),
      healthEpoch: ref(0),
      connect: async () => {
        ++connects
      },
      client: { request, debugger: client },
    } as unknown as NodeConnection,
    'sample-chat',
    'sample-node'
  )
  // Inspection metadata is outside this channel-lifecycle fixture.
  binding.refresh = async () => {}
  await binding.open(snapshot.debug_session_id)
  binding.controller.registerSource('sample-source', 'sample-app.js')
  for (const [wait_id, finish] of waits)
    finish({ wait_id, reason: 'connection_lost', elapsed_ms: 0, snapshot: null })
  waits.clear()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  DebuggerService.instance.select(binding)
  await revealSidebarView(GlobalStore.getInstance().app, 'abele-debug-view')
  await nextTick()
  return debuggerReconnectFixtureState()
}

export function debuggerReconnectFixtureState() {
  return {
    status: binding?.controller.session.status,
    current: binding?.controller.current,
    unavailable: binding?.controller.session.unavailable === true,
    reads,
    connects,
  }
}
