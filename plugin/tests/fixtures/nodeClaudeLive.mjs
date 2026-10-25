#!/usr/bin/env node
// Deterministic long-lived stream-json CLI fixture, NOT evidence of installed Claude compatibility.
// Copied from AbeleNode's tests/fixtures/claude-live.mjs (node 0.4.16) for the plugin's live e2e,
// with `stream <deltas> <ms>`: an answer streamed as text deltas, as a long reply arrives.
// Shapes follow recorded headless runs: replayed inputs, results as turn boundaries, background
// tasks that start turns by themselves, stdio permission requests, compaction, control requests.
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log('2.1.301 (Claude Code)')
  process.exit()
}
if (argv.includes('--help')) {
  console.log(
    '--include-partial-messages --forward-subagent-text --resume --setting-sources --max-budget-usd --input-format --replay-user-messages --allow-dangerously-skip-permissions'
  )
  process.exit()
}
const arg = (name) => {
  const i = argv.indexOf(name)
  return i < 0 ? null : argv[i + 1]
}
appendFileSync(
  'invocations.jsonl',
  JSON.stringify({
    args: argv,
    config_dir: process.env.CLAUDE_CONFIG_DIR ?? null,
    pid: process.pid,
  }) + '\n'
)
const session_id = arg('--resume') ?? '22222222-2222-4222-8222-222222222222'
let model = arg('--model')
let mode = arg('--permission-mode')
const effort = arg('--effort')
let turns = 0
const emit = (r) => process.stdout.write(JSON.stringify({ ...r, session_id }) + '\n')
const say = (id, text) =>
  emit({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] } })
const result = (text, extra = {}) => {
  turns++
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: 1,
    duration_ms: 5,
    total_cost_usd: 0,
    queued_turn_count: 0,
    ...extra,
  })
}
const echo = (content, uuid) =>
  emit({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid,
    isReplay: true,
  })
const begin = () => {
  emit({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    model,
    permissionMode: mode,
    messaging_socket_path: `/tmp/cc-socks-fixture/${process.pid}.sock`,
  })
  emit({ type: 'system', subtype: 'status', status: 'requesting' })
}
let bridge
let mcpId = 0
const mcpWaiting = new Map()
const mcp = async (method, params) => {
  if (!bridge) {
    const config = JSON.parse(readFileSync(arg('--mcp-config'), 'utf8'))
    const server = Object.values(config.mcpServers ?? {})[0]
    if (!server) return { error: 'no_mcp_server' }
    bridge = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let buffer = ''
    bridge.stdout.setEncoding('utf8')
    bridge.stdout.on('data', (data) => {
      buffer += data
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const r = JSON.parse(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        mcpWaiting.get(r.id)?.(r)
        mcpWaiting.delete(r.id)
      }
    })
    await mcp('initialize', { protocolVersion: '2025-06-18' })
  }
  const id = ++mcpId
  return new Promise((resolve) => {
    mcpWaiting.set(id, resolve)
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
let busy = false
const jobs = []
let boundary // resolves a waiting turn with { interrupted } or { injected }
const controls = new Map()
const run = async () => {
  if (busy) return
  busy = true
  while (jobs.length) await jobs.shift()()
  busy = false
}
const enqueue = (job) => {
  jobs.push(job)
  void run()
}
const waitBoundary = () => new Promise((resolve) => (boundary = resolve))
const background = (ms, label) => {
  const task_id = 'task-' + label
  emit({
    type: 'assistant',
    message: {
      id: 'bg-' + label,
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-' + label,
          name: 'Bash',
          input: { command: 'sleep', run_in_background: true },
        },
      ],
    },
  })
  emit({
    type: 'system',
    subtype: 'task_started',
    task_id,
    tool_use_id: 'tool-' + label,
    description: 'Background ' + label,
    is_backgrounded: true,
    task_type: 'local_bash',
  })
  emit({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id, task_type: 'local_bash', description: 'Background ' + label }],
  })
  emit({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-' + label, content: 'running' }],
    },
    parent_tool_use_id: null,
  })
  setTimeout(() => {
    emit({ type: 'system', subtype: 'task_updated', task_id, patch: { status: 'completed' } })
    emit({
      type: 'system',
      subtype: 'task_notification',
      task_id,
      status: 'completed',
      summary: 'Background ' + label,
    })
    emit({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
    enqueue(async () => {
      begin()
      say('notified-' + label, 'BG-NOTIFIED ' + label)
      result('BG-NOTIFIED ' + label)
    })
  }, ms)
}
const turn = async (content, uuid) => {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  // The real CLI frames every input it takes as a command before anything else.
  emit({ type: 'command_lifecycle', command_uuid: 'cmd-' + turns, state: 'started' })
  if (/^\/compact(\s|$)/.test(text)) {
    // Compaction is not echoed: its status is what says it was taken.
    emit({ type: 'system', subtype: 'status', status: 'compacting' })
    emit({ type: 'system', subtype: 'status', status: null, compact_result: 'success' })
    emit({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 5000, post_tokens: 300, duration_ms: 10 },
    })
    emit({
      type: 'user',
      message: {
        role: 'user',
        content:
          'This session is being continued from a previous conversation. Summary: ' +
          text.slice('/compact'.length).trim(),
      },
      parent_tool_use_id: null,
    })
    result('', { num_turns: 0 })
    return
  }
  echo(content, uuid)
  begin()
  if (text === 'crash') process.exit(3)
  // The CLI changes its own mode, as leaving plan mode does once the owner approves the plan.
  const own = /^mode (\w+)$/.exec(text)
  if (own) {
    mode = own[1]
    emit({ type: 'system', subtype: 'status', status: null, permissionMode: mode })
    say('mode-' + turns, 'mode ' + mode)
    return result('mode ' + mode)
  }
  if (text === 'whoami') {
    const who = JSON.stringify({
      model,
      effort,
      mode,
      config_dir: process.env.CLAUDE_CONFIG_DIR ?? null,
    })
    say('who-' + turns, who)
    return result(who)
  }
  // The node's MCP tools, called through the server the node configured, as the CLI would.
  const tool = /^mcp (\S+)(?: (.*))?$/s.exec(text)
  if (tool || text === 'tools') {
    const answer = tool
      ? await mcp('tools/call', { name: tool[1], arguments: JSON.parse(tool[2] ?? '{}') })
      : await mcp('tools/list', {})
    const reply = tool
      ? (answer.result?.content?.[0]?.text ?? JSON.stringify(answer))
      : (answer.result?.tools ?? []).map((t) => t.name).join(',')
    say('mcp-' + turns, reply)
    return result(reply)
  }
  // Output written while nobody reads it: the turn goes on and finishes by itself.
  const pause = /^pause (\d+)$/.exec(text)
  if (pause) {
    say('before-' + turns, 'before-pause')
    await new Promise((r) => setTimeout(r, Number(pause[1])))
    say('after-' + turns, 'after-pause')
    return result('after-pause')
  }
  const work = /^work (\w+) (\d+) (\d+)$/.exec(text)
  if (work) {
    const tag = work[1]
    emit({
      type: 'assistant',
      message: {
        id: 'thinking-' + tag,
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Check the parser, edit the sample, then run the focused tests.',
          },
        ],
      },
    })
    for (let k = 0; k < 4; k++) {
      const id = `tool-${tag}-${k}`
      const name = ['Read', 'Grep', 'Edit', 'Bash'][k]
      emit({
        type: 'assistant',
        message: {
          id,
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id,
              name,
              input:
                name === 'Edit'
                  ? { file_path: 'sample.ts', old_string: 'before', new_string: 'after' }
                  : name === 'Bash'
                    ? { command: 'npm test -- sample' }
                    : { file_path: 'sample.ts' },
            },
          ],
        },
      })
      emit({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: Array.from(
                { length: 80 },
                (_, i) => `sample line ${i}: focused test output`
              ).join('\n'),
            },
          ],
        },
      })
    }
  }
  const streamed = work ? [text, work[2], work[3]] : /^stream (\d+) (\d+)$/.exec(text)
  if (streamed) {
    const id = work ? 'streamed-' + work[1] : 'streamed-' + turns
    emit({ type: 'stream_event', event: { type: 'message_start', message: { id } } })
    emit({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    })
    let all = ''
    for (let k = 0; k < Number(streamed[1]); k++) {
      const piece = work
        ? `${work[1]} word${k}: the focused tests pass after the parser change. `
        : `word${k} `
      all += piece
      emit({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: piece },
        },
      })
      await new Promise((r) => setTimeout(r, Number(streamed[2])))
    }
    emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    say(id, all.trim())
    return result('streamed')
  }
  const bg = /^background (\d+) (\w+)$/.exec(text)
  if (bg) {
    background(Number(bg[1]), bg[2])
    say('started-' + bg[2], 'started ' + bg[2])
    return result('started ' + bg[2])
  }
  if (text === 'slow') {
    emit({
      type: 'assistant',
      message: {
        id: 'slow-' + turns,
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'slow-tool', name: 'Bash', input: { command: 'sleep' } }],
      },
    })
    emit({
      type: 'system',
      subtype: 'task_started',
      task_id: 'slow-task',
      tool_use_id: 'slow-tool',
      description: 'Foreground sleep',
      is_backgrounded: false,
      task_type: 'local_bash',
    })
    const outcome = await waitBoundary()
    if (outcome.interrupted) {
      emit({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'slow-task',
        status: 'stopped',
        summary: 'Foreground sleep',
      })
      emit({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'slow-tool',
              content: 'interrupted',
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: null,
      })
      return result('', { subtype: 'error_during_execution', is_error: true })
    }
    // A message written during the turn lands at this tool boundary: one result covers both.
    echo(outcome.injected.content, outcome.injected.uuid)
    say('injected-' + turns, 'INJECTED ' + outcome.injected.content)
    return result('INJECTED ' + outcome.injected.content)
  }
  if (text === 'tool') {
    const input = { command: 'printf fixture > allowed.txt' }
    emit({
      type: 'assistant',
      message: {
        id: 'tool-' + turns,
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'perm-tool-' + turns, name: 'Bash', input }],
      },
    })
    let allowed = mode === 'bypassPermissions'
    if (!allowed) {
      const request_id = 'perm-' + turns
      emit({
        type: 'control_request',
        request_id,
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input,
          tool_use_id: 'perm-tool-' + turns,
          description: 'Write a fixture file',
        },
      })
      const answer = await Promise.race([
        new Promise((resolve) => controls.set(request_id, resolve)),
        waitBoundary(),
      ])
      boundary = undefined
      if (answer.interrupted) {
        emit({ type: 'control_cancel_request', request_id })
        return result('', { subtype: 'error_during_execution', is_error: true })
      }
      allowed = answer.behavior === 'allow'
    }
    if (allowed) writeFileSync('allowed.txt', 'fixture')
    emit({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'perm-tool-' + turns,
            content: allowed ? 'done' : 'denied',
            is_error: !allowed,
          },
        ],
      },
      parent_tool_use_id: null,
    })
    say('tool-done-' + turns, allowed ? 'allowed' : 'denied')
    return result(allowed ? 'allowed' : 'denied')
  }
  say('reply-' + turns, 'reply:' + text)
  result('reply:' + text)
}
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (!line.trim()) return
  const r = JSON.parse(line)
  if (r.type === 'user') {
    if (busy && boundary && !jobs.length) {
      const resolve = boundary
      boundary = undefined
      return resolve({ injected: { content: r.message.content, uuid: r.uuid } })
    }
    return enqueue(() => turn(r.message.content, r.uuid))
  }
  if (r.type === 'control_response') {
    controls.get(r.response.request_id)?.(r.response.response)
    controls.delete(r.response.request_id)
    return
  }
  if (r.type !== 'control_request') return
  const reply = (response) =>
    emit({
      type: 'control_response',
      response: { subtype: 'success', request_id: r.request_id, response },
    })
  const request = r.request
  if (request.subtype === 'interrupt') {
    reply({ still_queued: [] })
    const resolve = boundary
    boundary = undefined
    resolve?.({ interrupted: true })
  } else if (request.subtype === 'set_model') {
    model = request.model
    echo(`<local-command-stdout>Set model to ${model}</local-command-stdout>`)
    reply(undefined)
  } else if (request.subtype === 'set_permission_mode' && request.mode === 'dontAsk') {
    // Stands for a mode the running CLI refuses.
    emit({
      type: 'control_response',
      response: { subtype: 'error', request_id: r.request_id, error: 'refused' },
    })
  } else if (request.subtype === 'set_permission_mode') {
    mode = request.mode
    reply({ mode })
    emit({ type: 'system', subtype: 'status', status: null, permissionMode: mode })
  } else if (request.subtype === 'get_context_usage')
    reply({
      totalTokens: 1000 + turns * 100,
      maxTokens: 1000000,
      percentage: 0,
      autoCompactThreshold: 967000,
      isAutoCompactEnabled: true,
      model,
      categories: [{ name: 'Messages', tokens: 1000 + turns * 100 }],
      memoryFiles: [{ path: '/not/for/the/journal' }],
    })
  else
    emit({
      type: 'control_response',
      response: { subtype: 'error', request_id: r.request_id, error: 'unsupported' },
    })
})
lines.on('close', () => {
  bridge?.stdin.end()
  const wait = () => (busy ? setTimeout(wait, 10) : process.exit(0))
  wait()
})
