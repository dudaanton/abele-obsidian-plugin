// Tools over the saved requests of the project the Requests view shows: list them, read one,
// save one, send one and ask what came of a send. They belong with the debugger's tools: a send
// may go into the recording of a running program, and its run is then read with the trace tools.
// Keys are only ever named, `${abele_key:name}`: no tool takes or shows a key's value, and a send
// the agent makes never asks to allow an address for a key or to confirm a script.
import { nodeProjectGuard } from './node/projectAccess'
import type { AgentTool, AgentToolResult } from '../client'
import type { RequestsModel } from '@/requests/RequestsModel'
import type { RequestDoc } from '@/requests/wire'
import type { ChatSession } from '../ChatSession'
import { requestLifetime, untilAborted } from '@/requests/lifetime'
import { TRACE_AGENT_BYTES, TRACE_AGENT_LINES } from './TraceTools'

/** The saved requests the tools work on: the project the Requests view shows. */
export interface RequestToolContext {
  registrationId?: string
  worktreeId?: string
  workspaceId?: string
  model: RequestsModel
  /** The project's name, to say which one. */
  project: string
}

const text = (t: string): AgentToolResult => ({ content: [{ type: 'text', text: t }] })
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const req = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Lines under the agent's ceiling, saying where to go on when it stops. */
function bounded(lines: string[], from = 0): string {
  const out: string[] = []
  let bytes = 0
  let i = from
  for (; i < lines.length && out.length < TRACE_AGENT_LINES; i++) {
    const size = Buffer.byteLength(lines[i]) + 1
    if (bytes + size > TRACE_AGENT_BYTES && out.length) break
    out.push(lines[i].slice(0, TRACE_AGENT_BYTES))
    bytes += size
  }
  if (i < lines.length) out.push(`… cut at the limit; call again with from: ${i}`)
  return out.join('\n')
}

const PAIRS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
      off: { type: 'boolean', description: 'Kept in the request but not sent.' },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
}
const ID = {
  type: 'string',
  description: 'The request id from http_requests: its path, e.g. Orders/Create order.http.',
}

function pairs(v: unknown) {
  return Array.isArray(v)
    ? v
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({
          key: req(p.key),
          value: req(p.value),
          ...(p.off === true ? { off: true } : {}),
        }))
        .filter((p) => p.key)
    : []
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** A request id as the node gives it: a path inside the requests folder ending in `.http`. */
function requestId(v: unknown): string {
  const id = req(v)
  if (
    !/\.http$/.test(id) ||
    id.split(/[\\/]/).some((part) => !part || part === '..' || part.startsWith('.')) ||
    /^[A-Za-z]:/.test(id)
  )
    throw new Error(`Not a request id: ${id}. Take one from http_requests.`)
  return id
}

/** A script's name as its header declares it: one plain line. */
function scriptName(v: unknown): string {
  const name = req(v).trim()
  if (!name || name.length > 200 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))
    throw new Error(`Not a script name: ${JSON.stringify(name)}`)
  return name
}

/** A collection: a folder inside the requests folder, its parts plain names. */
function collectionName(v: unknown): string {
  const name = (str(v) ?? '').trim() || 'Requests'
  const parts = name.split(/[\\/]/).map((p) => p.trim())
  if (parts.some((p) => !p || p === '..' || p.startsWith('.')) || /^[A-Za-z]:/.test(name))
    throw new Error(`Not a collection name: ${name}`)
  return parts.join('/')
}

export function createRequestTools(
  resolve: (
    params: Record<string, unknown>,
    session?: ChatSession
  ) => RequestToolContext | undefined | Promise<RequestToolContext | undefined>
): AgentTool[] {
  const context = async (params: Record<string, unknown>, session?: ChatSession) => {
    const c = await resolve(params, session)
    if (!c)
      throw new Error(
        'No node project selected. Call node_folders, then pass node, project and workspace to http_requests; no need to open Requests.'
      )
    return c
  }
  const loaded = async (c: RequestToolContext) => {
    if (!c.model.state.collections.length && !c.model.state.environments.length)
      await c.model.load()
    return c.model
  }
  const tool = (
    name: string,
    label: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    run: (
      c: RequestToolContext,
      p: Record<string, unknown>,
      signal?: AbortSignal
    ) => Promise<string>
  ): AgentTool => ({
    name,
    label,
    category: 'Nodes',
    description,
    parameters: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node ID or unique name; omit for the sole granted node.',
        },
        project: {
          type: 'string',
          description: 'Project ID from node_folders; omit for the sole granted project.',
        },
        workspace: {
          type: 'string',
          description:
            'Worktree ID from node_folders; omit for the selected or sole granted worktree.',
        },
        ...properties,
      },
      required,
      additionalProperties: false,
    },
    execute: async (_id, params, signal, ctx) => {
      const lifetime = requestLifetime(signal, name === 'http_send')
      let sendId: string | undefined
      try {
        lifetime.signal.throwIfAborted()
        const c = await untilAborted(context(params, ctx?.session), lifetime.signal)
        const guard = await untilAborted(
          nodeProjectGuard(
            ctx?.session,
            name,
            {
              ...c,
              ...(c.workspaceId ? { worktreeId: undefined } : {}),
              projectId: c.model.projectId,
            },
            undefined,
            ctx?.interactive === true && ctx?.approved === true
          ),
          lifetime.signal
        )
        lifetime.signal.throwIfAborted()
        if (name === 'http_send') lifetime.deadline(c.model.timeout(req(params.id)) + 1000)
        const model = c.model.forAgent(lifetime.signal, guard, (id) => {
          sendId = id
        })
        const result = await untilAborted(
          run({ ...c, model }, params, lifetime.signal),
          lifetime.signal
        )
        guard()
        return text(result)
      } catch (error) {
        if (sendId && error instanceof Error)
          throw new Error(
            `${error.message} Send ID: ${sendId}; use http_send_result with this ID.`,
            { cause: error }
          )
        throw error
      } finally {
        lifetime.dispose()
      }
    },
  })

  return [
    tool(
      'http_requests',
      'Saved requests',
      'List saved HTTP requests in a granted node project/worktree, without opening Requests. Pass node, project and workspace to select one; omit for the sole granted place. Lists collections, request ids, methods, addresses, last sends and environments. Read-only.',
      {},
      [],
      async (c) => {
        const m = await loaded(c)
        const lines = [
          `Project ${c.project}. Environment: ${m.state.environment ?? 'none'}${
            m.state.environments.length > 1
              ? ` (also ${m.state.environments.filter((e) => e !== m.state.environment).join(', ')})`
              : ''
          }`,
          ...m.state.collections.flatMap((col) => [
            `${col.name || '(top level)'}:`,
            ...col.requests.map(
              (r) =>
                `  ${r.id} · ${r.method} ${r.url}${
                  r.last
                    ? ` · last ${r.last.failed ? 'did not get through' : r.last.unknown ? 'outcome unknown' : r.last.status}`
                    : ''
                }`
            ),
          ]),
        ]
        return m.state.collections.length
          ? bounded(lines)
          : `${lines[0]}\nNo saved requests yet. http_request_save makes one.`
      }
    ),
    tool(
      'http_request_read',
      'Read a saved request',
      'Read one saved request as it is written: method, address, params, headers (keys by name), body, scripts and checks, and its last sends with their ids. Read-only.',
      { id: ID },
      ['id'],
      async (c, p) => {
        const m = await loaded(c)
        const id = requestId(p.id)
        await m.open(id)
        const e = m.entry(id)
        const d = e.doc
        if (!d) throw new Error(`No saved request ${id}`)
        const pair = (x: { key: string; value: string; off?: boolean }) =>
          `  ${x.off ? '(off) ' : ''}${x.key}: ${x.value}`
        return bounded([
          `${d.name} · ${d.method} ${d.url}`,
          ...(d.params.length ? ['Params:', ...d.params.map(pair)] : []),
          ...(d.headers.length ? ['Headers:', ...d.headers.map(pair)] : []),
          ...(d.body ? [`Body (${d.body.format}):`, ...d.body.text.split('\n').slice(0, 40)] : []),
          ...(d.scripts.before ? [`Script before: ${d.scripts.before}`] : []),
          ...(d.scripts.after ? [`Script after: ${d.scripts.after}`] : []),
          ...(d.checks.length ? ['Checks:', ...d.checks.map((x) => `  ${x}`)] : []),
          ...(e.history.length
            ? [
                'Last sends:',
                ...e.history
                  .slice(0, 5)
                  .map(
                    (h) =>
                      `  ${h.id} · ${h.at} · ${h.environment || 'no environment'} · ${h.failed ? 'did not get through' : h.status}${h.ms !== undefined ? ` · ${h.ms} ms` : ''}${h.intoRun ? ' · into a recording' : ''}`
                  ),
              ]
            : []),
        ])
      }
    ),
    tool(
      'http_request_save',
      'Save a request',
      'Make a saved request or replace one: method, address with {{variables}} of the environment, params, headers, body, checks (status == 201, body.items[0].id == "x", header content-type contains json, ms < 500). Name keys only as ${abele_key:name}; never write a key’s value. Scripts are named, and only scripts marked @request run. Without id it is made in the collection under its name.',
      {
        id: { ...ID, description: 'An existing request to replace; omit to make a new one.' },
        collection: { type: 'string', description: 'Folder for a new request, e.g. Orders.' },
        name: { type: 'string' },
        method: { type: 'string', enum: [...METHODS] },
        url: { type: 'string', description: 'Without the query: put that in params.' },
        params: PAIRS,
        headers: PAIRS,
        body: { type: 'string' },
        body_format: { type: 'string', enum: ['json', 'text', 'form'] },
        checks: { type: 'array', items: { type: 'string' } },
        script_before: { type: 'string' },
        script_after: { type: 'string' },
      },
      ['name', 'method', 'url'],
      async (c, p) => {
        const m = await loaded(c)
        const method = req(p.method).toUpperCase()
        if (!(METHODS as readonly string[]).includes(method))
          throw new Error(`Not a method: ${method}`)
        const doc: RequestDoc = {
          name: req(p.name).trim() || 'Request',
          method: method as RequestDoc['method'],
          url: req(p.url),
          params: pairs(p.params),
          headers: pairs(p.headers),
          ...(str(p.body)
            ? {
                body: {
                  format: (str(p.body_format) as 'json' | 'text' | 'form') ?? 'json',
                  text: req(p.body),
                },
              }
            : {}),
          scripts: {
            ...(str(p.script_before) ? { before: scriptName(p.script_before) } : {}),
            ...(str(p.script_after) ? { after: scriptName(p.script_after) } : {}),
          },
          checks: Array.isArray(p.checks)
            ? p.checks.filter((x): x is string => typeof x === 'string')
            : [],
        }
        const existing = p.id === undefined ? undefined : requestId(p.id)
        if (existing) {
          await m.flush(existing)
          await m.rpc.save(m.projectId, existing, doc)
          m.entry(existing).doc = doc
          await m.load()
          return `Saved ${existing}.`
        }
        const id = await m.create(collectionName(p.collection), doc.name, doc)
        return `Made ${id}.`
      }
    ),
    tool(
      'http_send',
      'Send a saved request',
      'Send a saved request from the node in the environment in use, or the one named. Asks the person first by default, showing exactly what goes. into_recording sends it into the recording of the program being recorded in this project, so the steps the code took meanwhile stand under it; read them with the trace tools. A send whose outcome is unknown may have reached the service: never send it again to find out, ask http_send_result. Keys go in only where the person already allowed their address.',
      {
        id: ID,
        environment: { type: 'string', description: 'Switches the Requests view to it first.' },
        into_recording: { type: 'boolean' },
      },
      ['id'],
      async (c, p, signal) => {
        const m = await loaded(c)
        const env = str(p.environment)
        if (env && env !== m.state.environment) {
          if (!m.state.environments.includes(env)) throw new Error(`No environment named ${env}`)
          await m.selectEnvironment(env)
        }
        const id = requestId(p.id)
        const outcome = await m.send(id, {
          interactive: false,
          signal,
          intoRecording: p.into_recording === true,
        })
        const e = m.entry(id)
        const sendId = e.history[0]?.id
        const run = sendId ? e.runs.get(sendId) : undefined
        const head = `Send ${sendId ?? '(id unknown)'} in ${m.state.environment ?? 'no environment'}.`
        switch (outcome.kind) {
          case 'answered': {
            const r = outcome.response
            return bounded([
              head,
              `${r.status} ${r.reason} · ${r.ms} ms · ${r.bytes} B${r.cut ? ' (cut)' : ''}`,
              ...(run
                ? [
                    `Into run ${run.runId}${run.step ? `, step ${run.step}` : ''}; ${r.steps ?? 0} ${r.steps === 1 ? 'step' : 'steps'} in code.`,
                  ]
                : []),
              ...(r.checks?.length
                ? [`Checks: ${r.checks.map((x) => `${x.passed ? '✓' : '✕'} ${x.text}`).join('; ')}`]
                : []),
              'Body:',
              ...r.body.split('\n'),
            ])
          }
          case 'failed':
            return `${head}\nDid not reach the service: ${outcome.reason}`
          case 'unknown':
            return `${head}\nOutcome unknown: ${outcome.reason ?? `no answer in ${outcome.after}`}. It may have reached the service; do not send it again to find out.`
          default:
            return `${head}\nStill sending; ask http_send_result.`
        }
      }
    ),
    tool(
      'http_import',
      'Import requests',
      'Bring requests in from another client: the text of a .http file, a curl line, a HAR file, an OpenAPI description (JSON or YAML) or a Bruno request; the format is read off the text. Each becomes a saved request in collection (or the folder the source names); values the source names are added to the environment in use when it lacks them. Credentials in it are left out and named, never saved.',
      {
        text: { type: 'string' },
        format: { type: 'string', enum: ['http', 'curl', 'har', 'openapi', 'bruno'] },
        collection: { type: 'string' },
      },
      ['text'],
      async (c, p) => {
        const { importRequests } = await import('@/requests/importers')
        const { importInto, importWords } = await import('@/requests/importInto')
        const m = await loaded(c)
        const imported = importRequests(
          req(p.text),
          str(p.format) as Parameters<typeof importRequests>[1]
        )
        const outcome = await importInto(
          m,
          imported,
          p.collection === undefined ? undefined : collectionName(p.collection)
        )
        return bounded([
          importWords(outcome, m.state.environment),
          ...outcome.made,
          ...(outcome.skipped.length ? ['Skipped:', ...outcome.skipped.map((x) => `  ${x}`)] : []),
        ])
      }
    ),
    tool(
      'http_send_result',
      'Result of a send',
      'What came of an earlier send, by its id from http_send or http_request_read: the status and the body a page at a time, or that it never got through, or that its outcome is unknown. Read-only.',
      {
        id: ID,
        send: { type: 'string', description: 'The send id.' },
        from: { type: 'number', description: 'The line to go on from.' },
      },
      ['id', 'send'],
      async (c, p) => {
        const m = await loaded(c)
        const id = requestId(p.id)
        await m.showSend(id, req(p.send))
        const o = m.entry(id).outcome
        if (!o) return 'Nothing known of that send.'
        if (o.kind === 'failed') return `Did not reach the service: ${o.reason}`
        if (o.kind === 'unknown')
          return `Outcome unknown: ${o.reason ?? `no answer in ${o.after}`}. It may have reached the service.`
        if (o.kind !== 'answered') return 'Still sending.'
        const r = o.response
        const from = num(p.from) ?? 0
        return bounded(
          [`${r.status} ${r.reason} · ${r.ms} ms · ${r.bytes} B`, ...r.body.split('\n')],
          from
        )
      }
    ),
  ]
}
