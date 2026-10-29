// Tools over a run the debugger recorded, for the agent to read it a little at a time. The run
// lives on the node; every answer is one of its bounded views, at the agent's ceiling (80 lines,
// 6 KB), which no parameter lifts. There is no tool that shows a run or a value whole.
import { nodeProjectGuard } from './node/projectAccess'
import type { AgentTool, AgentToolResult } from '../client'
import type { TraceRpc, WireStep } from '@/debugger/trace/wire'
import type { PointEdit } from '@/debugger/trace/TraceSession'
import { isAbsoluteFolder } from '@/debugger/trace/notesFolder'

export const TRACE_AGENT_LINES = 80
export const TRACE_AGENT_BYTES = 6 * 1024

/** The recording the tools read, resolved by source or explicit process. */
export interface TraceToolContext {
  sessionId?: string
  rpc: TraceRpc
  projectId: string
  registrationId: string
  worktreeId?: string
  workspaceId?: string
  /** The newest run first. */
  runs(): Promise<
    { id: string; name: string; steps: number; state: string; debugSessionId?: string }[]
  >
  listPoints?(): Promise<string>
  addPoint(
    file: string,
    line: number,
    edit: PointEdit,
    guard?: () => void
  ): Promise<void | { recording: boolean; reason?: string }>
  removePoint(file: string, line: number, guard?: () => void): Promise<void>
  writeNote(runId: string): Promise<string>
}

const text = (t: string): AgentToolResult => ({ content: [{ type: 'text', text: t }] })

/** Lines under the agent's ceiling, saying where to go on when it stops. */
function bounded(lines: string[], from = 0, unit = 'from'): string {
  const out: string[] = []
  let bytes = 0
  let i = 0
  for (; i < lines.length && out.length < TRACE_AGENT_LINES; i++) {
    const size = Buffer.byteLength(lines[i]) + 1
    if (bytes + size > TRACE_AGENT_BYTES && out.length) break
    out.push(lines[i].slice(0, TRACE_AGENT_BYTES))
    bytes += size
  }
  if (i < lines.length) out.push(`… cut at the limit; call again with ${unit}: ${from + i}`)
  return out.join('\n')
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
/** A required string parameter; anything else is the empty string the node refuses. */
const req = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const stepLine = (s: WireStep) =>
  [
    s.id,
    `+${(s.at / 1000).toFixed(2)}s`,
    s.kind,
    JSON.stringify(s.label),
    s.place ? `${s.place.file}:${s.place.line}` : (s.host ?? ''),
    s.values
      .map((v) =>
        v.failed
          ? `${v.name}=✕(${v.failed})`
          : v.same
            ? `${v.name}=same`
            : `${v.name}=${v.brief} [${v.bytes} B]`
      )
      .join('; '),
    s.marked ? 'marked' : '',
  ]
    .filter(Boolean)
    .join(' · ')

const RUN = {
  type: 'string',
  description: 'Run id from trace_runs; the newest run of this process if omitted.',
}
const STEP = { type: 'string', description: 'Step id, e.g. t0042.' }
const NAME = { type: 'string', description: 'The value name at that step, e.g. result.' }

export function createTraceTools(
  resolve: (params?: Record<string, unknown>) => TraceToolContext | undefined
): AgentTool[] {
  let lastSession: string | undefined
  const context = (params: Record<string, unknown>) => {
    const c = resolve({
      ...(!params.run &&
      !params.file &&
      !params.session &&
      params.process === undefined &&
      lastSession
        ? { session: lastSession }
        : {}),
      ...params,
    })
    if (!c)
      throw new Error(
        'No debugger session that records runs is open. Use the node debugger tools to start or attach to a program, then retry.'
      )
    return c
  }
  const runOf = async (c: TraceToolContext, params: Record<string, unknown>) => {
    const asked = str(params.run)
    if (asked) return asked
    const runs = await c.runs()
    const newest = runs.find(
      (r) => !c.sessionId || !r.debugSessionId || r.debugSessionId === c.sessionId
    )
    if (!newest)
      throw new Error(
        `No runs recorded for this process yet. Other runs: ${runs.map((r) => r.id).join(', ') || 'none'}. Specify run to read one.`
      )
    return newest.id
  }
  const tool = (
    name: string,
    label: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    run: (c: TraceToolContext, p: Record<string, unknown>) => Promise<string>
  ): AgentTool => ({
    name,
    label,
    category: 'Nodes',
    description,
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Select the process that runs this source path.' },
        ...properties,
        session: {
          type: 'string',
          description: 'Explicit debugger session ID; required for ambiguous shared sources.',
        },
        process: { type: 'integer', minimum: 1, description: 'Explicit process PID.' },
      },
      required,
      additionalProperties: false,
    },
    execute: async (_id, params, _signal, ctx) => {
      const base = resolve()
      if (base)
        await nodeProjectGuard(
          ctx?.session,
          name,
          base,
          undefined,
          ctx?.interactive === true && ctx?.approved === true
        )
      const c = context(params)
      const guard = await nodeProjectGuard(
        ctx?.session,
        name,
        c,
        undefined,
        ctx?.interactive === true && ctx?.approved === true
      )
      _signal?.throwIfAborted()
      const result = await run(
        {
          ...c,
          removePoint: (file, line) =>
            c.removePoint(file, line, () => {
              _signal?.throwIfAborted()
              guard()
            }),
          addPoint: (file, line, edit) =>
            c.addPoint(file, line, edit, () => {
              _signal?.throwIfAborted()
              guard()
            }),
        },
        params
      )
      guard()
      if (c.sessionId) lastSession = c.sessionId
      return text(result)
    },
  })

  return [
    tool(
      'trace_runs',
      'Recorded runs',
      'List the runs the debugger recorded in the open debug session’s project, newest first: id, name, steps, state (recording, done, cut). Read-only.',
      {},
      [],
      async (c) => {
        const runs = await c.runs()
        return runs.length
          ? bounded(
              runs.map((r) => `${r.id} · ${JSON.stringify(r.name)} · ${r.steps} steps · ${r.state}`)
            )
          : 'No runs recorded in this project yet. A run is recorded while a record point is set.'
      }
    ),
    tool(
      'trace_timeline',
      'Run timeline',
      'The steps of a recorded run in time: id, time from the start, kind, label, place in the code, each value as name=brief [bytes] (=same when unchanged since the last time, ✕ when it could not be taken). At most 80 lines; continue with from. Read-only.',
      {
        run: RUN,
        from: {
          type: ['number', 'string'],
          description: 'Zero-based step index or step id, e.g. t0008 (inclusive).',
        },
        kind: {
          type: 'string',
          enum: ['probe', 'error', 'http', 'browser-lost'],
          description: 'Only steps of this kind.',
        },
      },
      [],
      async (c, p) => {
        const run = await runOf(c, p)
        let index = num(p.from)
        if (typeof p.from === 'string' && /^t[0-9]+$/.test(p.from)) {
          let offset = 0
          for (;;) {
            const page = await c.rpc.run(c.projectId, run, offset, TRACE_AGENT_LINES)
            const found = page.steps.findIndex((step) => step.id === p.from)
            if (found >= 0) {
              index = offset + found
              break
            }
            if (page.next === undefined || page.next <= offset) {
              const others = (await c.runs()).filter((r) => r.id !== run).slice(0, 8)
              throw new Error(
                `Step ${p.from} is not in run ${run}. Other runs: ${others.map((r) => r.id).join(', ') || 'none'}. Specify run explicitly; trace_runs lists all runs.`
              )
            }
            offset = page.next
          }
        }
        if (
          p.from !== undefined &&
          (index === undefined || !Number.isSafeInteger(index) || index < 0)
        )
          throw new Error('from must be a nonnegative step index or a step id such as t0008')
        const from = index ?? 0
        const others = !p.run ? (await c.runs()).filter((r) => r.id !== run) : []
        const page = await c.rpc.run(c.projectId, run, from, TRACE_AGENT_LINES)
        const kind = str(p.kind)
        const steps = kind ? page.steps.filter((s) => s.kind === kind) : page.steps
        const head = `${page.run.name} · ${page.run.steps} steps · ${page.run.state} · run ${run}${
          others.length
            ? ` · other runs: ${others
                .slice(0, 8)
                .map((r) => r.id)
                .join(', ')}${others.length > 8 ? ' (trace_runs lists all)' : ''}`
            : ''
        }`
        const body = bounded(steps.map(stepLine), from)
        return `${head}\n${body}${page.next !== undefined && !body.includes('call again') ? `\n… more steps; call again with from: ${page.next}` : ''}`
      }
    ),
    tool(
      'trace_shape',
      'Value shape',
      'The shape of one recorded value: keys, types, list lengths, optional keys, one example per leaf; for XML the element tree with counts. Use it before trace_slice to find a path. Read-only.',
      { run: RUN, step: STEP, name: NAME },
      ['step', 'name'],
      async (c, p) => {
        const r = await c.rpc.value(
          c.projectId,
          await runOf(c, p),
          req(p.step),
          req(p.name),
          'shape',
          {
            cap: 'agent',
          }
        )
        const lines: string[] = [
          `${r.value.name} · ${r.value.format} · ${r.value.bytes} B · ${r.value.brief}`,
        ]
        const walk = (n: NonNullable<typeof r.shape>, depth: number) => {
          lines.push(
            `${'  '.repeat(depth)}${n.key ?? '$'}: ${n.type}${n.count !== undefined ? ` (${n.count})` : ''}${n.optional ? ' optional' : ''}${n.example ? ` e.g. ${n.example}` : ''}`
          )
          for (const ch of n.children ?? []) walk(ch, depth + 1)
        }
        if (r.shape) walk(r.shape, 0)
        return bounded(lines)
      }
    ),
    tool(
      'trace_slice',
      'Value slice',
      'The data of one recorded value at a path, formatted: JSON paths like $.items[7].id or $.items[*].amount, XML and text by lines L10-L40, $ for the start. The only way to see the data itself; at most 80 lines or 6 KB, continue with from. Read-only.',
      {
        run: RUN,
        step: STEP,
        name: NAME,
        path: {
          type: 'string',
          description: 'JSON path, or L<from>-L<to> for XML/text; $ for the start.',
        },
        from: { type: 'number', description: 'Line of the slice to continue from.' },
      },
      ['step', 'name', 'path'],
      async (c, p) => {
        const from = Math.max(0, Math.floor(num(p.from) ?? 0))
        const r = await c.rpc.value(
          c.projectId,
          await runOf(c, p),
          req(p.step),
          req(p.name),
          'slice',
          {
            path: req(p.path),
            from,
            cap: 'agent',
          }
        )
        const page = r.page
        if (!page) return 'Nothing at that path.'
        return `${page.lines.join('\n')}${page.next !== undefined ? `\n… cut at the limit; call again with from: ${page.next} (of ${page.total} lines)` : ''}`
      }
    ),
    tool(
      'trace_diff',
      'Value changes',
      'What changed in a recorded value: against the same name at the step before by default, or against another step and name. A summary line, then changes grouped over list elements (added, removed, changed type, changed value) with counts. Read-only.',
      {
        run: RUN,
        step: STEP,
        name: NAME,
        against_step: {
          type: 'string',
          description: 'Compare with this step instead of the one before.',
        },
        against_name: {
          type: 'string',
          description: 'The value name at against_step; the same name if omitted.',
        },
      },
      ['step', 'name'],
      async (c, p) => {
        const against = str(p.against_step)
          ? { step: req(p.against_step), name: str(p.against_name) ?? req(p.name) }
          : undefined
        const r = await c.rpc.value(
          c.projectId,
          await runOf(c, p),
          req(p.step),
          req(p.name),
          'changes',
          {
            ...(against ? { against } : {}),
            cap: 'agent',
          }
        )
        const ch = r.changes
        if (!ch) return 'Nothing to compare with.'
        return bounded([
          `against ${ch.against.step} ${ch.against.name}: ${ch.summary}`,
          ...ch.changes.map(
            (x) =>
              `${x.kind} ${x.path}${x.before !== undefined || x.after !== undefined ? `: ${x.before ?? ''} → ${x.after ?? ''}` : ''}${x.count > 1 ? ` in ${x.count} places` : ''}`
          ),
        ])
      }
    ),
    tool(
      'trace_find',
      'Find in run',
      'Where a value or a key occurs across every value of a recorded run: step, value name, path. loose matches a number and the same number written as a string. Read-only.',
      {
        run: RUN,
        value: { type: ['string', 'number', 'boolean'], description: 'The value to look for.' },
        key: { type: 'string', description: 'A key name to look for instead of a value.' },
        loose: { type: 'boolean' },
      },
      [],
      async (c, p) => {
        const value = p.value as string | number | boolean | undefined
        const key = str(p.key)
        if (value === undefined && !key) throw new Error('Give a value or a key to look for.')
        const hits = await c.rpc.find(c.projectId, await runOf(c, p), {
          ...(value !== undefined ? { value } : {}),
          ...(key ? { key } : {}),
          ...(p.loose === true ? { loose: true } : {}),
        })
        return hits.length
          ? bounded(hits.map((h) => `${h.step} · ${h.name} · ${h.path}`))
          : 'Not found in this run.'
      }
    ),
    tool(
      'trace_follow',
      'Follow a value',
      'The trail of one value through a recorded run: each step where it appears, its path there, and where its path or type changed; where it was last seen. Read-only.',
      { run: RUN, value: { type: ['string', 'number', 'boolean'] } },
      ['value'],
      async (c, p) => {
        const t = await c.rpc.follow(
          c.projectId,
          await runOf(c, p),
          p.value as string | number | boolean
        )
        if (!t.stops.length) return 'Not seen in this run.'
        return bounded([
          ...t.stops.map(
            (s) => `${s.step} · ${s.name} · ${s.path}${s.change ? ` · ${s.change}` : ''}`
          ),
          ...(t.lost_after ? [`not seen after ${t.lost_after}`] : []),
        ])
      }
    ),
    tool(
      'trace_mark',
      'Mark in run',
      'Mark a step, a value or a path in a recorded run with a comment, for the person and for a note about the run. Tag question to put it among the note’s questions.',
      {
        run: RUN,
        step: STEP,
        name: NAME,
        path: { type: 'string' },
        comment: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      ['step', 'comment'],
      async (c, p) => {
        const run = await runOf(c, p)
        await c.rpc.mark(c.projectId, run, {
          step: req(p.step),
          ...(str(p.name) ? { name: req(p.name) } : {}),
          ...(str(p.path) ? { path: req(p.path) } : {}),
          comment: req(p.comment),
          ...(Array.isArray(p.tags)
            ? { tags: p.tags.filter((t): t is string => typeof t === 'string') }
            : {}),
        })
        return `Marked ${[req(p.step), str(p.name), str(p.path)].filter(Boolean).join(' ')}.`
      }
    ),
    tool(
      'trace_point_add',
      'Add record point',
      'Set a record point in the process that runs the file, independently of the viewed session. Specify session or process for shared files. No open file tab is required. Take named values (names in scope or expressions, `expr as name`) each time the program passes and let it go on. Optional when (condition) and note (why the point is there).',
      {
        file: { type: 'string', description: 'The source path as the debugger shows it.' },
        line: { type: 'number' },
        take: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only these are taken; empty takes nothing.',
        },
        when: { type: 'string' },
        note: { type: 'string' },
      },
      ['file', 'line', 'take'],
      async (c, p) => {
        const take = Array.isArray(p.take)
          ? p.take.filter((t): t is string => typeof t === 'string')
          : []
        const line = Math.floor(num(p.line) ?? 0)
        if (line < 1) throw new Error('line must be a positive line number')
        const result = await c.addPoint(req(p.file), line, {
          take,
          ...(str(p.when) ? { when: req(p.when) } : {}),
          ...(str(p.note) ? { note: req(p.note) } : {}),
        })
        if (result && !result.recording)
          return `Record point is not recording at ${req(p.file)}:${line}. ${result.reason ?? 'Check that the selected process runs this file.'}`
        return take.length
          ? `Record point set at ${req(p.file)}:${line}, taking ${take.join(', ')}.`
          : `Record point set at ${req(p.file)}:${line}, taking nothing: name what to take for it to record values.`
      }
    ),
    tool(
      'trace_point_remove',
      'Remove record point',
      'Remove the record point and its breakpoint in the process that runs the file. Specify session or process for shared files. Requires the same edit access and approval as trace_point_add. Other points are kept.',
      { file: { type: 'string' }, line: { type: 'integer', minimum: 1 } },
      ['file', 'line'],
      async (c, p) => {
        const line = num(p.line)
        if (!line || !Number.isInteger(line) || line < 1)
          throw new Error('line must be a positive line number')
        await c.removePoint(req(p.file), line)
        return `Record point removed at ${req(p.file)}:${line}.`
      }
    ),
    tool(
      'trace_point_list',
      'Record points',
      'List record points in the process that runs file, or in an explicit session/process. Read-only.',
      { file: { type: 'string' } },
      [],
      async (c) =>
        bounded(
          (c.listPoints ? await c.listPoints() : 'No record points in this session.').split('\n')
        )
    ),
    tool(
      'trace_note',
      'Note about a run',
      'Write a note about a recorded run into the folder the settings name: record points, the timeline, each step’s values with their shape and first lines, marks and questions, each linked to the whole value on the node. Answers with the note’s path; add your account of the flow under its last heading. The folder may be outside the vault, where vault file tools cannot reach the note.',
      { run: RUN },
      [],
      async (c, p) => {
        const path = await c.writeNote(await runOf(c, p))
        return isAbsoluteFolder(path)
          ? `Note written outside the vault: ${path}. Vault file tools cannot reach it; give the person your account of the flow in the chat.`
          : `Note written: ${path}`
      }
    ),
  ]
}
