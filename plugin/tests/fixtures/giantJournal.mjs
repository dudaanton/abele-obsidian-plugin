// An invented journal of one long-lived Claude Code session on a node, as large as a real one
// gets after days of work: questions, answers, runs of tool calls with long outputs, background
// work waking it, several compactions. Deterministic for a given size. Plain JavaScript so the
// unit tier, the e2e tier and a script writing a node's own database can all use it.

const WORDS =
  'the search reads titles now and the tests pass while the build waits for the next change in the parser'.split(
    ' '
  )
const sentence = (n, i) =>
  Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ') + '.'
/** A tool's output of about `bytes` bytes, lines of a test run or a file. */
const output = (bytes, i) => {
  const lines = []
  let size = 0
  for (let k = 0; size < bytes; k++) {
    const line = `sample-output ${i}:${k} ${sentence(8, i + k)}`
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}

/**
 * @param {{ stream?: string, node?: string, turns?: number, toolsPerTurn?: number,
 *   outputBytes?: number, compactEvery?: number, start?: number }} [options]
 * @returns {{ kind: 'event', node_id: string, stream_id: string, seq: number, type: string,
 *   data: Record<string, unknown>, actor: { kind: 'node' }, at: string }[]}
 */
export function giantJournal(options = {}) {
  const {
    stream = 'sample-giant-session',
    node = 'sample-node',
    turns = 5000,
    toolsPerTurn = 3,
    outputBytes = 2000,
    compactEvery = 1200,
    start = Date.parse('2026-01-01T08:00:00.000Z'),
  } = options
  const events = []
  let at = start
  const push = (type, data) => {
    at += 1000
    events.push({
      kind: 'event',
      node_id: node,
      stream_id: stream,
      seq: events.length + 1,
      type,
      data,
      actor: { kind: 'node' },
      at: new Date(at).toISOString(),
    })
  }
  const run = 'sample-process'
  push('session.created', {
    session_id: stream,
    title: 'Sample long session',
    provider: 'claude',
    created_at: new Date(start).toISOString(),
  })
  push('session.process', { run_id: run, state: 'running' })
  for (let t = 1; t <= turns; t++) {
    const input = `i${t}`
    const woke = t % 50 === 0
    if (!woke)
      push('input.accepted', { input_id: input, text: `Question ${t}: ${sentence(12, t)}` })
    else
      push('claude.task', {
        run_id: run,
        subtype: 'task_notification',
        task_id: `k${t}`,
        status: 'completed',
        summary: `npm test finished · ${t % 97} passed`,
      })
    push('turn.started', { run_id: run, turn_id: `t${t}`, trigger: woke ? 'task' : 'input' })
    for (let k = 0; k < toolsPerTurn; k++) {
      const id = `tool-${t}-${k}`
      const name = ['Bash', 'Read', 'Grep', 'Edit'][k % 4]
      push('claude.tool.call', {
        run_id: run,
        tool_use_id: id,
        name,
        input:
          name === 'Edit'
            ? { file_path: `src/sample-${t}.ts`, old_string: 'before', new_string: 'after' }
            : name === 'Bash'
              ? { command: `npm test -- sample-${t}` }
              : { file_path: `src/sample-${t}-${k}.ts` },
      })
      push('claude.tool.result', {
        run_id: run,
        tool_use_id: id,
        content: output(outputBytes, t + k),
      })
    }
    push('claude.message.final', {
      run_id: run,
      message_id: `m${t}`,
      role: 'assistant',
      content: [{ type: 'text', text: `Answer ${t}. ${sentence(40, t)}` }],
    })
    push('turn.completed', {
      run_id: run,
      turn_id: `t${t}`,
      outcome: 'success',
      input_ids: woke ? [] : [input],
      subtype: 'success',
      num_turns: 1,
      duration_ms: 1000,
      total_cost_usd: 0.01,
      terminal_reason: null,
    })
    push('session.context', {
      run_id: run,
      total_tokens: 20000 + (t % compactEvery) * 700,
      max_tokens: 1000000,
      percentage: null,
      auto_compact_threshold: null,
      auto_compact_enabled: true,
      model: 'opus',
      categories: [],
    })
    if (t % compactEvery === 0) {
      push('compaction.started', { run_id: run })
      push('compaction.completed', {
        run_id: run,
        result: 'success',
        trigger: 'auto',
        pre_tokens: 860000,
        post_tokens: 60000,
        duration_ms: 20000,
        error: null,
      })
      push('compaction.summary', { run_id: run, text: `Retelling ${t}: ${sentence(60, t)}` })
    }
  }
  return events
}
