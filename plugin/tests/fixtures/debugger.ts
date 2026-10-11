import { DebuggerSnapshotSchema, DebuggerSnapshotResultSchema } from '@abele/node-protocol'
export function debuggerSnapshot(patch = {}) {
  return DebuggerSnapshotSchema.parse({
    version: 'debugger.v1',
    debug_session_id: 'sample-debug',
    incarnation: 'sample-incarnation',
    state_revision: 4,
    breakpoint_revision: 2,
    event_seq: 8,
    stop_epoch: 3,
    observed_at: '2025-01-01T00:00:00.000Z',
    target: {
      node_id: 'sample-node',
      project_id: 'sample-project',
      workspace_id: null,
      worktree_id: 'sample-tree',
      conversation_id: 'sample-chat',
      target_id: 'sample-target',
      adapter_profile: 'sample-js',
      adapter_version: 'sample-version',
      launch_configuration_id: 'sample-launch',
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
    pending_approvals: [],
    pending_commands: [],
    ...patch,
  })
}
export function debuggerStatus(patch = {}) {
  const snapshot = debuggerSnapshot(patch)
  return DebuggerSnapshotResultSchema.parse({
    snapshot,
    cursor: {
      debug_session_id: snapshot.debug_session_id,
      incarnation: snapshot.incarnation,
      event_seq: snapshot.event_seq,
    },
  })
}
