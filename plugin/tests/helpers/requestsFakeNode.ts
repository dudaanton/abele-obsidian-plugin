// A node in memory for the saved requests: files as a map, sends answered after a status read or
// two. Shared by the model's tests and the agent tools' tests.
import { vi } from 'vitest'
import type { RequestsPorts } from '@/requests/RequestsModel'
import { HttpRpc, type EnvironmentDoc, type RequestDoc, type SendSummary } from '@/requests/wire'

export const doc = (over: Partial<RequestDoc> = {}): RequestDoc => ({
  name: 'Create sample',
  method: 'POST',
  url: '{{base}}/samples',
  params: [],
  headers: [{ key: 'Authorization', value: 'Bearer ${abele_key:sample-key}' }],
  body: { format: 'json', text: '{"qty":2}' },
  scripts: {},
  checks: ['status == 201'],
  ...over,
})

/** A node in memory: files as a map, sends answered after a few status reads. */
export function fakeNode() {
  const files = new Map<string, RequestDoc>([['Samples/Create sample.http', doc()]])
  const envs = new Map<string, EnvironmentDoc>([
    [
      'local',
      {
        name: 'local',
        vars: [
          { key: 'base', value: 'http://localhost:4000' },
          { key: 'token', secret: true },
        ],
      },
    ],
    ['staging', { name: 'staging', vars: [{ key: 'base', value: 'https://staging.test' }] }],
  ])
  const history = new Map<string, SendSummary[]>()
  const sent: Record<string, any>[] = []
  const answers = new Map<string, { reads: number; body: string; status: number }>()
  let n = 0
  const calls: string[] = []
  const request = async (method: string, p: any): Promise<unknown> => {
    calls.push(method)
    switch (method) {
      case 'http.v1.list': {
        const collections = new Map<string, any[]>()
        for (const [id, d] of files) {
          const c = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''
          if (!collections.has(c)) collections.set(c, [])
          const last = history.get(id)?.[0]
          collections.get(c)!.push({
            id,
            name: d.name,
            method: d.method,
            url: d.url,
            ...(last ? { last: { status: last.status } } : {}),
          })
        }
        return {
          folder: '/project/.abele/requests',
          collections: [...collections].map(([name, requests]) => ({ name, requests })),
          environments: [...envs.keys()],
        }
      }
      case 'http.v1.request.get':
        if (!files.has(p.id)) throw new Error('http_request_not_found')
        return { id: p.id, request: files.get(p.id) }
      case 'http.v1.request.save':
        if (p.create && files.has(p.id)) throw new Error('http_request_exists')
        if (p.from) files.delete(p.from)
        files.set(p.id, p.request)
        return { id: p.id }
      case 'http.v1.request.delete':
        files.delete(p.id)
        return { deleted: true }
      case 'http.v1.collection.create':
        return { name: p.name }
      case 'http.v1.env.get':
        return envs.get(p.name)
      case 'http.v1.env.save':
        envs.set(p.environment.name, p.environment)
        return p.environment
      case 'http.v1.send': {
        sent.push(p)
        const id = `s${String(++n).padStart(26, '0')}`
        answers.set(id, {
          reads: 0,
          status: 201,
          body: JSON.stringify({ token: 'tok-from-answer' }),
        })
        const summary: SendSummary = {
          id,
          at: new Date().toISOString(),
          environment: p.environment,
          method: p.method,
          url: p.url,
          status: 201,
          ms: 12,
          bytes: 30,
          ...(p.debug_session_id ? { run: { run_id: 'run-1', step: 't0003' } } : {}),
        }
        if (p.request_id) history.set(p.request_id, [summary, ...(history.get(p.request_id) ?? [])])
        return { send_id: id, ...(p.debug_session_id ? { run_id: 'run-1' } : {}) }
      }
      case 'http.v1.send.status': {
        const a = answers.get(p.send_id)!
        const summary = [...history.values()].flat().find((s) => s.id === p.send_id)!
        if (a.reads++ < 1) return { send: summary, outcome: { state: 'sending' } }
        return {
          send: {
            ...summary,
            ...(sent.at(-1)?.debug_session_id ? { run: { run_id: 'run-1', step: 't0003' } } : {}),
          },
          outcome: {
            state: 'answered',
            response: {
              status: a.status,
              reason: 'Created',
              ms: 12,
              bytes: a.body.length,
              headers: [{ key: 'content-type', value: 'application/json' }],
              body: a.body,
            },
          },
          ...(sent.at(-1)?.debug_session_id ? { code_steps: 2 } : {}),
        }
      }
      case 'http.v1.history':
        return { sends: history.get(p.id) ?? [] }
      case 'http.v1.body':
        return { text: answers.get(p.send_id)?.body ?? '', bytes: 0 }
    }
    throw new Error(`unexpected ${method}`)
  }
  return { files, envs, sent, history, calls, rpc: new HttpRpc(request) }
}

export function ports(over: Partial<RequestsPorts> = {}): RequestsPorts {
  const prefs = new Map<string, string>()
  return {
    keys: {
      has: (name) => name === 'sample-key',
      prepare: vi.fn(async (out) => ({
        out: {
          ...out,
          headers: Object.fromEntries(
            Object.entries(out.headers).map(([k, v]) => [
              k,
              (v as string).replace('${abele_key:sample-key}', 'key-value-1'),
            ])
          ),
        },
        secrets: ['key-value-1'],
      })),
    },
    scripts: { run: vi.fn(async () => undefined) },
    recording: () => undefined,
    prefs: { get: (k) => prefs.get(k), set: (k, v) => void prefs.set(k, v) },
    wait: () => Promise.resolve(),
    ...over,
  }
}
