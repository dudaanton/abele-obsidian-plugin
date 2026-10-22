import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetRequestSecrets,
  RequestsModel,
  requestIdFor,
  sentAtWords,
} from '@/requests/RequestsModel'
import { doc, fakeNode, ports } from '../helpers/requestsFakeNode'

beforeEach(() => forgetRequestSecrets())
it('looks up recordings with only the origin of a send containing secrets', async () => {
  const node = fakeNode()
  const id = 'Samples/Private.http'
  node.files.set(
    id,
    doc({
      url: 'https://sample-user:sample-pass@example.test:8443/{{privatePath}}?token=sample-token#hidden',
    })
  )
  const recording = vi.fn(() => undefined)
  const model = new RequestsModel(node.rpc, 'project-1', ports({ recording }))
  await model.load()
  await model.saveEnvironment({
    name: 'local',
    vars: [{ key: 'privatePath', secret: true, value: 'sample-private' }],
  })
  await model.send(id, { interactive: true, intoRecording: true })
  expect(recording).toHaveBeenCalledExactlyOnceWith('https://example.test:8443')
  expect(node.sent[0].url).toContain('/sample-private?token=sample-token')
})
it('routes recorded sends by destination and enables instrumentation correlation', async () => {
  const node = fakeNode()
  const model = new RequestsModel(
    node.rpc,
    'project-1',
    ports({
      recording: async () => ({
        sessionId: 'sample-owner',
        name: 'sample-server',
        routeByDestination: true,
        stepHeader: true,
      }),
    })
  )
  await model.load()
  await model.send('Samples/Create sample.http', { interactive: true, intoRecording: true })
  expect(node.sent[0]).toMatchObject({ route_by_destination: true, step_header: true })
  expect(node.sent[0]).not.toHaveProperty('debug_session_id')
})
it.each(['request_timeout', 'outcome_unknown'])(
  'recovers a %s status read without resending a held request',
  async (code) => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    vi.spyOn(node.rpc, 'status').mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    const outcome = await model.send('Samples/Create sample.http', { interactive: true })
    expect(outcome.kind).toBe('answered')
    expect(node.sent).toHaveLength(1)
  }
)

it('refreshes externally copied request files and stops following when the view closes', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'project-1', ports())
  await model.load()
  const list = vi.spyOn(node.rpc, 'list')
  const stop = model.followList(() => true)
  try {
    node.files.set('Samples/External.http', doc({ name: 'External' }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(
      model.state.collections.flatMap((c) => c.requests).some((r) => r.name === 'External')
    ).toBe(true)
    stop()
    const reads = list.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(list).toHaveBeenCalledTimes(reads)
  } finally {
    stop()
    vi.useRealTimers()
  }
})

describe('the requests of a project', () => {
  it('keeps an answer to a request edited during sending in history rather than under the new address', async () => {
    const node = fakeNode()
    const id = 'Samples/Create sample.http'
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.open(id)
    const status = node.rpc.status.bind(node.rpc)
    let release!: () => void
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(node.rpc, 'status').mockImplementation(async (...args) => {
      entered()
      await gate
      return status(...args)
    })
    const sending = model.send(id, { interactive: true })
    await reading
    model.change(id, doc({ url: 'https://example.test/changed' }))
    release()
    await sending
    expect(model.entry(id).outcome).toBeUndefined()
    expect(model.entry(id).history).toHaveLength(1)
    expect(model.state.collections[0]?.requests[0]?.url).toBe('https://example.test/changed')
    await model.flush(id)
  })
  it('uses a five minute wait by default and remembers a per-request timeout', async () => {
    const node = fakeNode()
    const p = ports()
    const id = 'Samples/Create sample.http'
    const model = new RequestsModel(node.rpc, 'project-1', p)
    await model.load()
    await model.send(id, { interactive: true })
    expect(node.sent[0]?.timeout_ms).toBe(300000)
    model.setTimeout(id, 60000)
    await model.send(id, { interactive: true })
    expect(node.sent[1]?.timeout_ms).toBe(60000)
    expect(new RequestsModel(node.rpc, 'project-1', p).timeout(id)).toBe(60000)
    expect(() => model.setTimeout(id, 300001)).toThrow()
  })
  it('starts an environment without an invented address', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.createEnvironment('empty')
    expect(model.state.env?.vars).toEqual([])
  })
  it('updates the sidebar immediately and clears an answer after an edit', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    const id = 'Samples/Create sample.http'
    await model.load()
    await model.send(id, { interactive: true })
    model.change(id, doc({ method: 'PUT', url: 'https://example.test/other' }))
    expect(model.state.collections[0]?.requests[0]).toMatchObject({
      method: 'PUT',
      url: 'https://example.test/other',
    })
    expect(model.entry(id).outcome).toBeUndefined()
    await model.flush(id)
  })
  it('creates an environment using the offered server address', async () => {
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.createEnvironment('development', 'http://localhost:4567')
    expect(model.state.env?.vars).toEqual([{ key: 'base', value: 'http://localhost:4567' }])
    expect(model.state.environment).toBe('development')
  })
  it('records sends by default and respects an explicit opt out', async () => {
    const node = fakeNode()
    const model = new RequestsModel(
      node.rpc,
      'project-1',
      ports({
        recording: () => ({ sessionId: 'debug-1', name: 'sample.js' }),
      })
    )
    await model.load()
    await model.send('Samples/Create sample.http', { interactive: true })
    expect(node.sent[0]).toHaveProperty('debug_session_id', 'debug-1')
    await model.send('Samples/Create sample.http', { interactive: true, intoRecording: false })
    expect(node.sent[1]).not.toHaveProperty('debug_session_id')
  })

  it.each(['answer', 'history'] as const)(
    'keeps a new send selected when an earlier %s finishes loading afterwards',
    async (delayed) => {
      const node = fakeNode()
      const seed = new RequestsModel(node.rpc, 'project-1', ports())
      const id = 'Samples/Create sample.http'
      await seed.load()
      await seed.selectEnvironment('local')
      await seed.send(id, { interactive: true })
      const earlier = (await node.rpc.history('project-1', id))[0]!.id
      const model = new RequestsModel(node.rpc, 'project-1', ports())
      await model.load()
      await model.selectEnvironment('local')
      let entered!: () => void
      let release!: () => void
      const reading = new Promise<void>((resolve) => {
        entered = resolve
      })
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const status = node.rpc.status.bind(node.rpc)
      if (delayed === 'answer') {
        vi.spyOn(node.rpc, 'status').mockImplementation(async (projectId, sendId) => {
          if (sendId === earlier) {
            entered()
            await held
          }
          return status(projectId, sendId)
        })
      } else {
        const history = node.rpc.history.bind(node.rpc)
        let first = true
        vi.spyOn(node.rpc, 'history').mockImplementation(async (projectId, requestId) => {
          const sends = await history(projectId, requestId)
          if (first) {
            first = false
            entered()
            await held
          }
          return sends
        })
      }
      const opening = model.open(id)
      await reading
      const fresh = await model.send(id, { interactive: true })
      const freshHistory = [...model.entry(id).history]
      release()
      await opening
      expect(model.entry(id).outcome).toEqual(fresh)
      expect(model.entry(id).shown).toBeUndefined()
      expect(model.entry(id).history).toEqual(freshHistory)
    }
  )

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
      headers: [
        { key: 'Authorization', value: 'Bearer key-value-1' },
        { key: 'Content-Type', value: 'application/json' },
      ],
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
      'The key absent is not on this device'
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
    expect(model.secrets()).toEqual({ token: 'tok-from-answer' })
    // Declared secrets stay in memory; undeclared script values are ordinary values.
    expect(node.envs.get('local')!.vars).toEqual([
      { key: 'base', value: 'http://localhost:4000' },
      { key: 'token', secret: true },
      { key: 'newer', value: 'n-1' },
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
    expect(requestIdFor('../up/./.dot/ok', 'x')).toBe('up/dot/ok/x.http')
    expect(requestIdFor(' . ./ .. ', ' . .x')).toBe('x.http')
  })
  it('says when a send went as it reads', () => {
    const now = new Date(2026, 9, 15, 12, 0)
    expect(sentAtWords(new Date(2026, 9, 15, 5, 12).toISOString(), now)).toBe('05:12')
    expect(sentAtWords(new Date(2026, 9, 14, 18, 40).toISOString(), now)).toBe('Yesterday 18:40')
    expect(sentAtWords(new Date(2026, 8, 3, 9, 5).toISOString(), now)).toBe('3 Sep 09:05')
  })
})
