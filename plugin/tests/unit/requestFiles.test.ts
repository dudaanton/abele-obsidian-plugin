import { describe, expect, it, vi } from 'vitest'
import { parseRequestFile, replaceRequestBlock } from '@/requests/files'
import { FileCollections } from '@/requests/FileCollections'

const source =
  '# @name create\nPOST https://example.test/items\n\n{}\n### Read\nGET https://example.test/items/{{create.response.body.$.id}}\n### Broken\nnot an address\n'

describe('project request files', () => {
  it('keeps origins, named requests and partial parsing problems', () => {
    const result = parseRequestFile('api/sample.http', source)
    expect(result.requests.map((r) => r.origin)).toEqual([
      { file: 'api/sample.http', line: 2 },
      { file: 'api/sample.http', line: 6 },
    ])
    expect(result.requests[0].captureName).toBe('create')
    expect(result.problems).toEqual([{ line: 8, text: expect.any(String) }])
  })
  it('shows source scripts without adding them to the outgoing body', () => {
    const result = parseRequestFile(
      'sample.http',
      'POST https://example.test\n\n{}\n> {% client.global.set("id", 1); %}'
    )
    expect(result.requests[0].doc.body?.text).toBe('{}')
    expect(result.requests[0].script).toContain('client.global.set')
    expect(result.requests[0].doc.scripts).toEqual({})
  })
  it('changes only the chosen block and preserves line endings', () => {
    const text = source.replaceAll('\n', '\r\n')
    const parsed = parseRequestFile('sample.http', text)
    const changed = replaceRequestBlock(text, parsed.requests[1], {
      ...parsed.requests[1].doc,
      url: 'https://example.test/other',
    })
    expect(changed).toContain('GET https://example.test/other\r\n### Broken\r\nnot an address')
    expect(changed.slice(0, changed.indexOf('### Read'))).toBe(
      text.slice(0, text.indexOf('### Read'))
    )
  })
  it('discovers through a port, scopes captures and refuses stale writes', async () => {
    let text = source
    const write = vi.fn(async () => {})
    const files = new FileCollections({
      list: async () => ['sample.http', 'other.rest', 'plain.bru'],
      read: async (path) => ({
        text:
          path === 'sample.http' ? text : 'GET https://example.test/{{create.response.body.id}}',
        contentId: text,
      }),
      write,
      watch: async () => () => {},
    })
    await files.refresh()
    expect(files.collections).toHaveLength(2)
    const [create, read] = files.collections[0].requests
    expect(files.captures(read.id)[0].value).toBeUndefined()
    files.capture(create.id, {
      status: 201,
      body: '{"id":"sample-42"}',
      headers: [{ key: 'Location', value: '/sample-42' }],
    })
    expect(files.captures(read.id)[0].value).toBe('sample-42')
    expect(files.captures(files.collections[1].requests[0].id)[0].value).toBeUndefined()
    text += '# external edit\n'
    await expect(
      files.save(read.id, { ...read.doc, url: 'https://example.test/new' })
    ).rejects.toThrow(/changed/)
    expect(write).not.toHaveBeenCalled()
  })
  it('marks deleted files gone while retaining an open entry', async () => {
    let paths = ['sample.http']
    const files = new FileCollections({
      list: async () => paths,
      read: async () => ({ text: source, contentId: 'v1' }),
      write: async () => {},
      watch: async () => () => {},
    })
    await files.refresh()
    const id = files.collections[0].requests[0].id
    paths = []
    await files.refresh()
    expect(files.collections).toEqual([])
    expect(files.get(id)?.gone).toBe(true)
  })
})

it('does not adopt an external baseline while an edit is pending', async () => {
  let text = source
  const write = vi.fn(async () => {})
  const files = new FileCollections({
    list: async () => ['sample.http'],
    read: async () => ({ text, contentId: text }),
    write,
    watch: async () => () => {},
  })
  await files.refresh()
  const request = files.collections[0].requests[0]
  files.beginEdit(request.id)
  text = text.replace('{}', '{"external":true}')
  await files.refresh()
  await expect(
    files.save(request.id, { ...request.doc, url: 'https://example.test/new' })
  ).rejects.toThrow(/changed/)
  expect(write).not.toHaveBeenCalled()
})

it('reads merged file environments and moves an exposed secret only on an explicit action', async () => {
  const contents: Record<string, string> = {
    'sample.http': source,
    'http-client.env.json': JSON.stringify({
      dev: { base: 'https://example.test', token: 'sample-secret' },
    }),
    'http-client.private.env.json': JSON.stringify({ dev: { password: 'sample-password' } }),
  }
  const write = vi.fn(async (path: string, _base: unknown, text: string) => {
    contents[path] = text
  })
  const files = new FileCollections({
    list: async () => Object.keys(contents),
    read: async (path) => ({ text: contents[path], contentId: contents[path] }),
    write,
    watch: async () => () => {},
  })
  await files.refresh()
  expect(files.environments[0].doc.vars).toHaveLength(3)
  expect(write).not.toHaveBeenCalled()
  const put = vi.fn(async () => 'sample-key')
  await files.moveSecret(files.environments[0].id, 'token', put)
  expect(put).toHaveBeenCalledWith('token', 'sample-secret')
  expect(contents['http-client.env.json']).not.toContain('sample-secret')
  expect(contents['http-client.env.json']).toContain('${abele_key:sample-key}')
  expect(contents['http-client.private.env.json']).toContain('sample-password')
})

it('blocks a dependent send, sends a chain in order, and stops on an error answer', async () => {
  const { RequestsModel } = await import('@/requests/RequestsModel')
  const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
  const node = fakeNode()
  const file =
    '# @name create\nPOST https://example.test/items\n\n{}\n### Read\nGET https://example.test/items/{{create.response.body.$.id}}\n### Later\nGET https://example.test/later'
  const model = new RequestsModel(
    node.rpc,
    'project-1',
    ports({
      files: {
        list: async () => ['sample.http'],
        read: async () => ({ text: file, contentId: 'v1' }),
        write: async () => {},
        watch: async () => () => {},
      },
    })
  )
  await model.load()
  const [create, read] = model.files!.collections[0].requests
  await expect(model.send(read.id, { interactive: true })).rejects.toThrow(/Send create first/)
  expect(node.sent).toHaveLength(0)
  vi.spyOn(node.rpc, 'status')
    .mockResolvedValueOnce({
      send: { id: 'first', at: new Date().toISOString(), method: 'POST', url: '' },
      outcome: {
        state: 'answered',
        response: {
          status: 201,
          reason: 'Created',
          ms: 1,
          bytes: 10,
          headers: [],
          body: '{"id":"sample-id"}',
        },
      },
    })
    .mockResolvedValueOnce({
      send: { id: 'second', at: new Date().toISOString(), method: 'GET', url: '' },
      outcome: {
        state: 'answered',
        response: { status: 500, reason: 'Error', ms: 1, bytes: 2, headers: [], body: '{}' },
      },
    })
  await model.sendAll('sample.http', { interactive: true })
  expect(node.sent).toHaveLength(2)
  expect(node.sent[1].url).toBe('https://example.test/items/sample-id')
  expect(node.sent[0]).not.toHaveProperty('request_id')
  expect(model.entry(create.id).outcome?.kind).toBe('answered')
})

it('preserves literal headers and body comments when editing only the address', () => {
  const text =
    '### Sample\r\nGET https://example.test/old\r\n# header note\r\nX-Sample: value\r\n\r\n# literal body line\r\n'
  const request = parseRequestFile('sample.http', text).requests[0]
  expect(
    replaceRequestBlock(text, request, { ...request.doc, url: 'https://example.test/new' })
  ).toBe(text.replace('/old', '/new'))
})

it('keeps a named request identity when a block is inserted ahead of it', () => {
  const before = parseRequestFile('sample.http', source).requests[0]
  const after = parseRequestFile('sample.http', 'GET https://example.test/first\n###\n' + source)
    .requests[1]
  expect(after.id).toBe(before.id)
})

it('does not serialize an existing exposed environment secret during an ordinary save', async () => {
  const files = new FileCollections({
    list: async () => ['sample.http', 'http-client.env.json'],
    read: async (path) => ({
      text: path.endsWith('.json') ? '{"dev":{"token":"sample-secret"}}' : source,
      contentId: 'v1',
    }),
    write: vi.fn(),
    watch: async () => () => {},
  })
  await files.refresh()
  await expect(files.saveEnvironment(files.environments[0].doc)).rejects.toThrow(/Move secrets/)
  expect(files.port.write).not.toHaveBeenCalled()
})

it('reports malformed headers without dropping the other requests', () => {
  const parsed = parseRequestFile(
    'sample.http',
    'GET https://example.test\nnot a header\n\n### Next\nGET https://example.test/next'
  )
  expect(parsed.requests).toHaveLength(2)
  expect(parsed.problems).toContainEqual({ line: 2, text: expect.any(String) })
})

it('releases a delayed watch from an older view lifetime', async () => {
  const { RequestsModel } = await import('@/requests/RequestsModel')
  const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
  let finish!: (stop: () => void) => void
  const release = vi.fn()
  const watch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue(() => {})
  const model = new RequestsModel(
    fakeNode().rpc,
    'sample-project',
    ports({
      files: {
        list: async () => [],
        read: async () => ({ text: '', contentId: '' }),
        write: async () => {},
        watch,
      },
    })
  )
  const first = model.followFiles()
  first()
  const second = model.followFiles()
  finish(release)
  await Promise.resolve()
  await Promise.resolve()
  expect(release).toHaveBeenCalledOnce()
  second()
  model.destroy()
})

it('does not silently send edits after a background save conflict', async () => {
  const { RequestsModel } = await import('@/requests/RequestsModel')
  const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
  const node = fakeNode()
  let text = source
  const model = new RequestsModel(
    node.rpc,
    'sample-project',
    ports({
      files: {
        list: async () => ['sample.http'],
        read: async () => ({ text, contentId: text }),
        write: async () => {},
        watch: async () => () => {},
      },
    })
  )
  await model.load()
  const id = model.files!.collections[0].requests[0].id
  await model.open(id)
  const changed = { ...model.entry(id).doc!, url: 'https://example.test/edited' }
  vi.useFakeTimers()
  model.change(id, changed)
  text += '# external\n'
  try {
    // A later send must not bypass a failed conditional save.
    await expect(model.flush(id)).rejects.toThrow(/changed/)
    await model.refreshFiles()
    expect(model.entry(id).doc?.url).toBe(changed.url)
    await expect(model.send(id, { interactive: true })).rejects.toThrow(/changed/)
    expect(node.sent).toHaveLength(0)
  } finally {
    vi.useRealTimers()
    model.destroy()
  }
})

it('edits a Bruno URL without duplicating query parameters or rewriting unrelated blocks', () => {
  const text =
    'meta {\n  name: Sample\n  type: http\n  seq: 2\n}\n\nget {\n  url: https://example.test/old\n  body: none\n  auth: none\n}\n\nparams:query {\n  page: 2\n}\n\nheaders {\n  X-Sample: value\n}\n'
  const request = parseRequestFile('collection/sample.bru', text).requests[0]
  const changed = replaceRequestBlock(text, request, {
    ...request.doc,
    url: 'https://example.test/new',
  })
  expect(changed).toBe(text.replace('/old', '/new'))
})

it('orders a Bruno collection by sequence and keeps problems at their actual source', async () => {
  const files = new FileCollections({
    list: async () => ['api/bruno.json', 'api/a.bru', 'api/b.bru'],
    read: async (path) => ({
      text: `meta {\n  name: ${path}\n  seq: ${path.endsWith('a.bru') ? 2 : 1}\n}\nget {\n  url: https://example.test\n}`,
      contentId: path,
    }),
    write: async () => {},
    watch: async () => () => {},
  })
  await files.refresh()
  expect(files.collections[0].requests.map((r) => r.origin.file)).toEqual([
    'api/b.bru',
    'api/a.bru',
  ])
})

it('lists exposed secrets from both environment files even when one shadows the other', async () => {
  const files = new FileCollections({
    list: async () => ['sample.http', 'http-client.env.json', 'http-client.private.env.json'],
    read: async (path) => ({
      text: path.endsWith('.json') ? '{"dev":{"token":"sample-secret"}}' : source,
      contentId: path,
    }),
    write: async () => {},
    watch: async () => () => {},
  })
  await files.refresh()
  expect(files.environments[0].exposed).toEqual([
    { key: 'token', file: 'http-client.env.json' },
    { key: 'token', file: 'http-client.private.env.json' },
  ])
})

it('reads source credentials and body comments without applying clipboard import filtering', () => {
  const parsed = parseRequestFile(
    'sample.http',
    'POST https://example.test\nAuthorization: Bearer sample-source-token\n\n# literal body text'
  )
  expect(parsed.requests[0].doc.headers).toEqual([
    { key: 'Authorization', value: 'Bearer sample-source-token' },
  ])
  expect(parsed.requests[0].doc.body?.text).toBe('# literal body text')
})

it('does not block the producer on an unused file variable that reads its own answer', async () => {
  const text =
    '@itemId = {{create.response.body.$.id}}\n### Create\n# @name create\nPOST https://example.test/items\n\n{}\n### Read\nGET https://example.test/items/{{itemId}}'
  const files = new FileCollections({
    list: async () => ['sample.http'],
    read: async () => ({ text, contentId: 'v1' }),
    write: async () => {},
    watch: async () => () => {},
  })
  await files.refresh()
  const [create, read] = files.collections[0].requests
  expect(files.captures(create.id)).toEqual([])
  files.capture(create.id, { status: 201, headers: [], body: '{"id":"sample-id"}' })
  expect(files.values(read.id).itemId).toBe('sample-id')
})

it('never turns a deleted file environment into a saved environment', async () => {
  const { RequestsModel } = await import('@/requests/RequestsModel')
  const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
  const node = fakeNode()
  let paths = ['sample.http', 'http-client.env.json']
  const model = new RequestsModel(
    node.rpc,
    'sample-project',
    ports({
      files: {
        list: async () => paths,
        read: async (path) => ({
          text: path.endsWith('.json') ? '{"dev":{"token":"sample-private-value"}}' : source,
          contentId: path,
        }),
        write: async () => {},
        watch: async () => () => {},
      },
    })
  )
  await model.load()
  const edit = model.files!.environments[0].doc
  paths = ['sample.http']
  await model.refreshFiles()
  const save = vi.spyOn(node.rpc, 'saveEnvironment')
  await expect(model.saveEnvironment(edit)).rejects.toThrow(/gone/)
  expect(save).not.toHaveBeenCalled()
})

it('resolves response headers case-insensitively and JSON array paths', async () => {
  const text =
    '# @name create\nPOST https://example.test/items\n\n{}\n### Next\nGET https://example.test/items/{{create.response.body.$.items[0].id}}\nX-Location: {{create.response.headers.Location}}'
  const files = new FileCollections({
    list: async () => ['sample.http'],
    read: async () => ({ text, contentId: 'v1' }),
    write: async () => {},
    watch: async () => () => {},
  })
  await files.refresh()
  const [create, next] = files.collections[0].requests
  files.capture(create.id, {
    status: 201,
    headers: [{ key: 'location', value: 'https://example.test/items/sample-id' }],
    body: '{"items":[{"id":"sample-id"}]}',
  })
  expect(files.values(next.id)).toMatchObject({
    'create.response.body.$.items[0].id': 'sample-id',
    'create.response.headers.Location': 'https://example.test/items/sample-id',
  })
})
