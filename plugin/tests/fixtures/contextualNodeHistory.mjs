/** Entirely synthetic command history, including retired receipts and shared session streams. */
export function contextualNodeHistory(withMutations = false) {
  const state = {
    node_id: 'sample-node',
    installation_id: 'sample-installation',
    cursors: {},
    windows: {},
    events: {},
    outbox: [],
    results: {},
    operationRequests: {},
    managerOperations: {},
    obsidianSessions: {},
    delegation: { tasks: {} },
  }
  const output = 'Sample command output line.\n'.repeat(150)
  for (let i = 0; i < 1200; i++) {
    const id = 'sample-operation-' + i
    const parent = 'sample-parent-' + (i % 2)
    const session = 'sample-session-' + (i % 4)
    const params = {
      context_id: 'sample-context-' + (i % 4),
      parent_chat_id: parent,
      command: 'printf sample',
      permission_mode: 'bypass',
      output_bytes: 16384,
    }
    const request = { method: 'command.context.v1.prepare', params }
    const run = {
      run_id: id,
      prompt_id: 'sample-prompt-' + i,
      session_id: session,
      context_id: params.context_id,
      method: 'command.v1.run',
      permission_mode: 'bypass',
      approval: null,
      state: 'exited',
      stdout: output + i,
      stderr: '',
      stdout_truncated: false,
      stderr_truncated: false,
      exit_code: 0,
      signal: null,
    }
    state.results[id] = { result: run, request, ...(i >= 201 ? { managerParent: parent } : {}) }
    state.operationRequests[id] = request
    if (i < 201)
      state.managerOperations[id] = {
        parent,
        method: 'command.v1.run',
        params,
        request: { command: params.command, worktree_id: 'sample-tree' },
        run: { ...run, state: i === 200 ? 'outcome_unknown' : 'exited', stdout: '' },
        observedSeq: 0,
        notified: true,
        stopped: true,
      }
  }
  for (let i = 0; i < 300; i++) {
    const id = 'sample-write-' + i
    state.results[id] = { result: { operation_id: id, state: 'saved', path: 'sample.txt' } }
  }
  for (let i = 0; i < 45; i++) {
    const session = i === 44 ? 'catalog' : 'sample-session-' + i
    const count = i === 44 ? 8200 : i < 30 ? 400 : 200
    state.cursors[session] = count
    if (i !== 44) state.windows[session] = 400
    state.events[session] = Array.from({ length: count }, (_, j) => ({
      kind: 'event',
      node_id: 'sample-node',
      stream_id: session,
      seq: j + 1,
      type: i === 44 ? 'sample.catalog.changed' : j % 2 ? 'command.updated' : 'command.output',
      actor: { kind: 'node' },
      at: '2026-01-01T00:00:00.000Z',
      data:
        i === 44
          ? { text: 'Sample catalogue entry. '.repeat(100) }
          : j % 2
            ? {
                run_id: 'sample-operation-' + (j % 201),
                state: 'exited',
                stdout: '',
                stderr: '',
                stdout_truncated: false,
                stderr_truncated: false,
              }
            : { run_id: 'sample-operation-' + (j % 201), stream: 'stdout', text: output },
    }))
  }
  for (let i = 0; i < 12; i++) state.obsidianSessions['sample-session-' + i] = 'sample-agent'
  if (withMutations) {
    state.chatMutations = {}
    for (let i = 0; i < 324; i++) {
      const id = 'sample-mutation-' + i
      const before = 'Sample file line.\n'
        .repeat(i < 32 ? 16000 : 240)
        .slice(0, i < 32 ? 256 * 1024 : 4096)
      state.chatMutations[id] = {
        operation_id: id,
        key: i.toString(16).padStart(64, '0'),
        chat_id: 'sample-chat',
        call_id: 'sample-call-' + i,
        principal: 'sample-principal',
        tool: 'node_write',
        request: { method: 'file.write', params: {} },
        before,
        after: before + '\nSample change',
        state: i === 323 ? 'outcome_unknown' : 'saved',
        ...(i === 323 ? {} : { receipt: { operation_id: id, state: 'saved' } }),
      }
    }
  }
  return state
}
