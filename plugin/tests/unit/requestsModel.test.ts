import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetRequestSecrets,
  RequestsModel,
  requestIdFor,
  sentAtWords,
  type RequestsPorts,
} from '@/requests/RequestsModel'
import { HttpRpc, type EnvironmentDoc, type RequestDoc, type SendSummary } from '@/requests/wire'

const doc = (over: Partial<RequestDoc> = {}): RequestDoc => ({
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
function fakeNode() {
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

function ports(over: Partial<RequestsPorts> = {}): RequestsPorts {
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

beforeEach(() => forgetRequestSecrets())

describe('the requests of a project', () => {
  it('lists collections, picks the environment it used last, and opens a request with its last answer', async () => {
    const node = fakeNode()
    const p = ports()
    p.prefs.set('environment', 'staging')
    const model = new RequestsModel(node.rpc, 'project-1', p)
    await model.load()
    expect(model.state.collections.map((c) => c.name)).toEqual(['Samples'])
    expect(model.state.environment).toBe('staging')
    await model.selectEnvironment('local')
    expect(p.prefs.get('environment')).toBe('local')
    await model.open('Samples/Create sample.http')
    expect(model.entry('Samples/Create sample.http').doc?.name).toBe('Create sample')
    expect(model.entry('Samples/Create sample.http').outcome).toBeUndefined()
  })

  it('sends with the environment and keys put in, and tells the node which values to blank', async () => {
    const node = fakeNode()
    const p = ports()
    const model = new RequestsModel(node.rpc, 'project-1', p)
    await model.load()
    await model.selectEnvironment('local')
    model.setSecret('token', 'tok-old')
    const outcome = await model.send('Samples/Create sample.http', { interactive: true })
    expect(outcome.kind).toBe('answered')
    expect(node.sent[0]).toMatchObject({
      request_id: 'Samples/Create sample.http',
      environment: 'local',
      method: 'POST',
      url: 'http://localhost:4000/samples',
      headers: [{ key: 'Authorization', value: 'Bearer key-value-1' }],
      body: '{"qty":2}',
    })
    expect(node.sent[0]!.secrets).toEqual(expect.arrayContaining(['key-value-1', 'tok-old']))
    expect(p.keys.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:4000/samples' }),
      true,
      undefined
    )
    const entry = model.entry('Samples/Create sample.http')
    expect(entry.outcome).toMatchObject({
      kind: 'answered',
      response: { status: 201, checks: [{ text: 'status == 201', passed: true }] },
    })
    expect(entry.history).toHaveLength(1)
    expect(model.state.collections[0]!.requests[0]!.last).toEqual({ status: 201 })
  })

  it('refuses to send while a variable has no value or a key is not there, and says why', async () => {
    const node = fakeNode()
    node.files.set('Samples/Broken.http', doc({ name: 'Broken', url: '{{nowhere}}/x' }))
    node.files.set(
      'Samples/No key.http',
      doc({ name: 'No key', headers: [{ key: 'X', value: '${abele_key:absent}' }] })
    )
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.selectEnvironment('local')
    await expect(model.send('Samples/Broken.http', { interactive: true })).rejects.toThrow(
      'nowhere has no value in local'
    )
    await expect(model.send('Samples/No key.http', { interactive: true })).rejects.toThrow(
      'There is no key named absent'
    )
    expect(node.sent).toEqual([])
  })

  it('runs the script before with the request and the one after with the answer, tokens kept in memory', async () => {
    const node = fakeNode()
    node.files.set(
      'Samples/Create sample.http',
      doc({ scripts: { before: 'Sign request', after: 'Keep token' } })
    )
    const run = vi.fn(async (name: string, input: any) => {
      if (name === 'Sign request')
        return { request: { headers: { ...input.request.headers, 'X-Signed': 'yes' } } }
      return { vars: { token: JSON.parse(input.response.body).token, newer: 'n-1' } }
    })
    const model = new RequestsModel(node.rpc, 'project-1', ports({ scripts: { run } }))
    await model.load()
    await model.selectEnvironment('local')
    await model.send('Samples/Create sample.http', { interactive: false })
    expect(run).toHaveBeenNthCalledWith(
      1,
      'Sign request',
      expect.objectContaining({ environment: 'local', vars: { base: 'http://localhost:4000' } }),
      false,
      undefined
    )
    expect(node.sent[0]!.headers).toContainEqual({ key: 'X-Signed', value: 'yes' })
    // The script never sees a key's value: keys go in after it.
    expect(JSON.stringify(run.mock.calls[0])).not.toContain('key-value-1')
    expect(model.secrets()).toEqual({ token: 'tok-from-answer', newer: 'n-1' })
    // A secret is not written; a variable the environment did not have stays in memory too.
    expect(node.envs.get('local')!.vars).toEqual([
      { key: 'base', value: 'http://localhost:4000' },
      { key: 'token', secret: true },
      { key: 'newer', secret: true },
    ])
    await model.send('Samples/Create sample.http', { interactive: false })
    expect(node.sent[1]!.secrets).toContain('tok-from-answer')
  })

  it('sends a token from an answer only back where it came from, and copies it by name', async () => {
    const node = fakeNode()
    node.files.set('Samples/Create sample.http', doc({ scripts: { after: 'Keep token' } }))
    node.files.set(
      'Samples/Elsewhere.http',
      doc({
        name: 'Elsewhere',
        url: 'https://elsewhere.test/collect',
        headers: [{ key: 'X-Token', value: '{{token}}' }],
      })
    )
    const run = vi.fn(async () => ({ vars: { token: 'tok-from-answer' } }))
    const model = new RequestsModel(node.rpc, 'project-1', ports({ scripts: { run } }))
    await model.load()
    await model.selectEnvironment('local')
    await model.send('Samples/Create sample.http', { interactive: true })
    await expect(model.send('Samples/Elsewhere.http', { interactive: true })).rejects.toThrow(
      'token is kept for http://localhost:4000 and is not sent anywhere else'
    )
    expect(node.sent).toHaveLength(1)
    expect((await model.prepared('Samples/Elsewhere.http')).headers['X-Token']).toBe('{{token}}')
  })

  it('binds a typed secret where a person first sends it; an agent never sends an unbound one', async () => {
    const node = fakeNode()
    node.files.set(
      'Samples/Create sample.http',
      doc({ headers: [{ key: 'X-Token', value: '{{token}}' }] })
    )
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.selectEnvironment('local')
    model.setSecret('token', 'typed-1')
    await expect(model.send('Samples/Create sample.http', { interactive: false })).rejects.toThrow(
      'token has not been sent anywhere yet'
    )
    await model.send('Samples/Create sample.http', { interactive: true })
    expect(node.sent[0]!.headers).toContainEqual({ key: 'X-Token', value: 'typed-1' })
    await model.send('Samples/Create sample.http', { interactive: false })
    expect(node.sent).toHaveLength(2)
  })

  it('a value the script sets that the environment keeps plainly is written', async () => {
    const node = fakeNode()
    node.files.set('Samples/Create sample.http', doc({ scripts: { after: 'Keep base' } }))
    const run = vi.fn(async () => ({ vars: { base: 'http://localhost:5000' } }))
    const model = new RequestsModel(node.rpc, 'project-1', ports({ scripts: { run } }))
    await model.load()
    await model.selectEnvironment('local')
    await model.send('Samples/Create sample.http', { interactive: true })
    expect(node.envs.get('local')!.vars[0]).toEqual({ key: 'base', value: 'http://localhost:5000' })
  })

  it('sends into the recording only when asked and one goes on, and points at its run', async () => {
    const node = fakeNode()
    let recording: { sessionId: string; name: string } | undefined
    const model = new RequestsModel(node.rpc, 'project-1', ports({ recording: () => recording }))
    await model.load()
    await model.selectEnvironment('local')
    model.state.intoRecording = true
    await model.send('Samples/Create sample.http', { interactive: true })
    expect(node.sent[0]).not.toHaveProperty('debug_session_id')
    recording = { sessionId: 'debug-1', name: 'server.js' }
    const outcome = await model.send('Samples/Create sample.http', { interactive: true })
    expect(node.sent[1]).toMatchObject({ debug_session_id: 'debug-1' })
    expect(outcome).toMatchObject({ kind: 'answered', response: { steps: 2 } })
    expect(
      model
        .entry('Samples/Create sample.http')
        .runs.get(node.history.get('Samples/Create sample.http')![0]!.id)
    ).toEqual({
      runId: 'run-1',
      step: 't0003',
    })
    expect(model.entry('Samples/Create sample.http').history[0]!.intoRun).toBe(true)
  })

  it('shows an earlier answer and compares bodies', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.selectEnvironment('local')
    const id = 'Samples/Create sample.http'
    await model.send(id, { interactive: true })
    await model.send(id, { interactive: true })
    const [latest, first] = model.entry(id).history
    await model.showSend(id, first!.id)
    expect(model.entry(id).shown).toBe(first!.id)
    expect(model.entry(id).outcome?.kind).toBe('answered')
    await model.compare(id, latest!.id)
    expect(model.entry(id).compare).toMatchObject({ id: latest!.id, body: expect.any(String) })
    await model.compare(id, undefined)
    expect(model.entry(id).compare).toBeUndefined()
  })

  it('creates, duplicates, renames and deletes requests as files', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    const id = await model.create('Samples', 'List samples')
    expect(id).toBe('Samples/List samples.http')
    expect(node.files.get(id)).toMatchObject({
      name: 'List samples',
      method: 'GET',
      url: '{{base}}/',
    })
    const copy = await model.duplicate(id)
    expect(copy).toBe('Samples/List samples copy.http')
    const renamed = await model.rename(copy, 'List: all/odd')
    expect(renamed).toBe('Samples/List- all-odd.http')
    expect(node.files.get(renamed)!.name).toBe('List: all/odd')
    await model.remove(renamed)
    expect(node.files.has(renamed)).toBe(false)
    expect(model.state.collections[0]!.requests.map((r) => r.name)).toEqual([
      'Create sample',
      'List samples',
    ])
  })

  it('writes an edit to the file once typing settles', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    const id = 'Samples/Create sample.http'
    await model.open(id)
    model.change(id, { ...model.entry(id).doc!, url: '{{base}}/other' })
    model.change(id, { ...model.entry(id).doc!, url: '{{base}}/other2' })
    await model.flush(id)
    expect(node.files.get(id)!.url).toBe('{{base}}/other2')
    expect(node.calls.filter((c) => c === 'http.v1.request.save')).toHaveLength(1)
  })

  it('says a send the node lost track of may have gone through, and never sends it again', async () => {
    const node = fakeNode()
    const rpc = node.rpc as any
    rpc.status = vi.fn(async () => {
      throw new Error('disconnected')
    })
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.selectEnvironment('local')
    const outcome = await model.send('Samples/Create sample.http', { interactive: true })
    expect(outcome).toMatchObject({ kind: 'unknown' })
    expect(node.sent).toHaveLength(1)
  })
})

describe('names and times', () => {
  it('makes a file name of a request name inside its collection', () => {
    expect(requestIdFor('', 'Ping')).toBe('Ping.http')
    expect(requestIdFor('A/B', ' .hidden: x ')).toBe('A/B/hidden- x.http')
  })
  it('says when a send went as it reads', () => {
    const now = new Date(2026, 9, 15, 12, 0)
    expect(sentAtWords(new Date(2026, 9, 15, 5, 12).toISOString(), now)).toBe('05:12')
    expect(sentAtWords(new Date(2026, 9, 14, 18, 40).toISOString(), now)).toBe('Yesterday 18:40')
    expect(sentAtWords(new Date(2026, 8, 3, 9, 5).toISOString(), now)).toBe('3 Sep 09:05')
  })
})
