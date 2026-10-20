import { describe, expect, it } from 'vitest'
import { detectFormat, importRequests } from '@/requests/importers'

it('reports response variables instead of importing unresolved expressions', () => {
  const result = importRequests(
    '@itemId = {{create.response.body.$.id}}\n### Create item\n# @name create\nPOST https://example.test/items\n\n{}\n### Read item\nGET https://example.test/items/{{itemId}}'
  )
  expect(result.vars).toEqual([])
  expect(result.warnings?.join(' ')).toMatch(/itemId.*response variable/i)
  expect(result.requests[0]?.doc.name).toBe('Create item')
})

describe('importing requests from other clients', () => {
  it('reads a .http file of several requests with its variables', () => {
    const text = [
      '@base = http://localhost:4000',
      '@token = should-not-travel',
      '',
      '### List samples',
      'GET {{base}}/samples?page=2',
      'Accept: application/json',
      '',
      '###',
      '# @name Create sample',
      'POST {{base}}/samples',
      'Content-Type: application/json',
      'Authorization: Bearer {{token}}',
      '',
      '{"qty": 2}',
      '',
    ].join('\n')
    expect(detectFormat(text)).toBe('http')
    const r = importRequests(text)
    expect(r.requests.map((x) => [x.doc.name, x.doc.method, x.doc.url])).toEqual([
      ['List samples', 'GET', '{{base}}/samples'],
      ['Create sample', 'POST', '{{base}}/samples'],
    ])
    expect(r.requests[0]!.doc.params).toEqual([{ key: 'page', value: '2' }])
    expect(r.requests[1]!.doc.body).toEqual({ format: 'json', text: '{"qty": 2}' })
    // A header holding a variable is kept: the value is in the environment, not the request.
    expect(r.requests[1]!.doc.headers).toContainEqual({
      key: 'Authorization',
      value: 'Bearer {{token}}',
    })
    expect(r.vars).toEqual([
      { key: 'base', value: 'http://localhost:4000' },
      { key: 'token', secret: true },
    ])
  })

  it('reads a curl line, leaving any credential out and saying so', () => {
    const text = `curl -X POST 'https://api.example.test/v1/orders?dry=1' \\
  -H 'Content-Type: application/json' \\
  -H "Authorization: Bearer sk-sample-0123" \\
  -u sample-user:sample-pass \\
  --data-raw '{"qty":3,"note":"it'\\''s fine"}' --compressed`
    expect(detectFormat(text)).toBe('curl')
    const r = importRequests(text)
    expect(r.requests).toHaveLength(1)
    const doc = r.requests[0]!.doc
    expect(doc).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/v1/orders',
      params: [{ key: 'dry', value: '1' }],
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: { format: 'json', text: `{"qty":3,"note":"it's fine"}` },
    })
    expect(JSON.stringify(r)).not.toContain('sk-sample-0123')
    expect(JSON.stringify(r)).not.toContain('sample-pass')
    expect(r.leftOut).toEqual(['Authorization', 'the user and password of -u'])
  })

  it('takes a body without a method as a POST, and -G as a query', () => {
    expect(importRequests(`curl https://x.test/a -d 'k=v'`).requests[0]!.doc).toMatchObject({
      method: 'POST',
      body: { format: 'form', text: 'k=v' },
    })
    expect(
      importRequests(`curl -G https://x.test/a --data-urlencode 'q=a b'`).requests[0]!.doc
    ).toMatchObject({ method: 'GET', params: [{ key: 'q', value: 'a b' }] })
  })

  it('reads a HAR file without its cookies or session headers', () => {
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://shop.example.test/api/items?limit=5',
              headers: [
                { name: ':authority', value: 'shop.example.test' },
                { name: 'Accept', value: 'application/json' },
                { name: 'Cookie', value: 'session=abc' },
              ],
              queryString: [{ name: 'limit', value: '5' }],
            },
          },
          {
            request: {
              method: 'POST',
              url: 'https://shop.example.test/api/cart',
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              queryString: [],
              postData: { mimeType: 'application/json', text: '{"id":"item-1"}' },
            },
          },
        ],
      },
    })
    expect(detectFormat(har)).toBe('har')
    const r = importRequests(har)
    expect(r.requests.map((x) => x.doc.name)).toEqual(['GET /api/items', 'POST /api/cart'])
    expect(r.requests[0]!.doc.headers).toEqual([{ key: 'Accept', value: 'application/json' }])
    expect(r.requests[0]!.doc.params).toEqual([{ key: 'limit', value: '5' }])
    expect(r.requests[1]!.doc.body?.text).toBe('{"id":"item-1"}')
    expect(r.leftOut).toEqual(['Cookie'])
    expect(r.vars).toEqual([{ key: 'base', value: 'https://shop.example.test' }])
    expect(r.requests[0]!.doc.url).toBe('{{base}}/api/items')
  })

  it('reads an OpenAPI description, YAML or JSON, as one request per operation', () => {
    const yaml = [
      'openapi: 3.0.3',
      'info: { title: Sample shop, version: "1" }',
      'servers: [{ url: "https://api.example.test/v2" }]',
      'paths:',
      '  /orders/{orderId}:',
      '    get:',
      '      summary: Read an order',
      '      tags: [Orders]',
      '      parameters:',
      '        - { name: orderId, in: path, required: true, schema: { type: string } }',
      '        - { name: expand, in: query, schema: { type: string, example: items } }',
      '        - { name: X-Trace, in: header, schema: { type: string, default: off } }',
      '  /orders:',
      '    post:',
      '      operationId: createOrder',
      '      tags: [Orders]',
      '      requestBody:',
      '        content:',
      '          application/json:',
      '            example: { qty: 2 }',
      '',
    ].join('\n')
    expect(detectFormat(yaml)).toBe('openapi')
    const r = importRequests(yaml)
    expect(r.collection).toBe('Sample shop')
    expect(r.vars).toEqual([
      { key: 'base', value: 'https://api.example.test/v2' },
      { key: 'orderId', value: '' },
    ])
    expect(r.requests.map((x) => [x.collection, x.doc.name, x.doc.method, x.doc.url])).toEqual([
      ['Orders', 'Read an order', 'GET', '{{base}}/orders/{{orderId}}'],
      ['Orders', 'createOrder', 'POST', '{{base}}/orders'],
    ])
    expect(r.requests[0]!.doc.params).toEqual([{ key: 'expand', value: 'items' }])
    expect(r.requests[0]!.doc.headers).toEqual([{ key: 'X-Trace', value: 'off' }])
    expect(r.requests[1]!.doc.body).toEqual({ format: 'json', text: '{\n  "qty": 2\n}' })
  })

  it('reads a Bruno request with its asserts as checks', () => {
    const bru = [
      'meta {',
      '  name: Create sample',
      '  type: http',
      '  seq: 1',
      '}',
      '',
      'post {',
      '  url: {{base}}/samples',
      '  body: json',
      '  auth: none',
      '}',
      '',
      'params:query {',
      '  source: import',
      '  ~debug: 1',
      '}',
      '',
      'headers {',
      '  Content-Type: application/json',
      '}',
      '',
      'body:json {',
      '  {',
      '    "qty": 2',
      '  }',
      '}',
      '',
      'assert {',
      '  res.status: eq 201',
      '}',
      '',
    ].join('\n')
    expect(detectFormat(bru)).toBe('bruno')
    const doc = importRequests(bru).requests[0]!.doc
    expect(doc).toEqual({
      name: 'Create sample',
      method: 'POST',
      url: '{{base}}/samples',
      params: [
        { key: 'source', value: 'import' },
        { key: 'debug', value: '1', off: true },
      ],
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: { format: 'json', text: '{\n  "qty": 2\n}' },
      scripts: {},
      checks: ['status == 201'],
    })
  })

  it('turns every secret written out in a query or a body into a value kept in memory', () => {
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: {
              method: 'POST',
              url: 'https://shop.example.test/login?api_key=k-123&page=1',
              headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
              queryString: [
                { name: 'api_key', value: 'k-123' },
                { name: 'page', value: '1' },
              ],
              postData: {
                mimeType: 'application/json',
                text: '{"user":"sample","password":"p-456","nested":{"client_secret":"c-789"}}',
              },
            },
          },
          {
            request: {
              method: 'POST',
              url: 'https://shop.example.test/form',
              headers: [{ name: 'X-Api-Key', value: '{{token}}extra' }],
              postData: { mimeType: 'application/x-www-form-urlencoded', text: 'user=a&pass=b-1' },
            },
          },
        ],
      },
    })
    const r = importRequests(har)
    const text = JSON.stringify(r.requests)
    for (const secret of ['k-123', 'p-456', 'c-789', 'b-1', 'extra'])
      expect(text).not.toContain(secret)
    expect(r.requests[0]!.doc.params).toEqual([
      { key: 'api_key', value: '{{api_key}}' },
      { key: 'page', value: '1' },
    ])
    // A variable and the scheme's word are not a credential written out.
    expect(r.requests[0]!.doc.headers).toEqual([
      { key: 'Authorization', value: 'Bearer {{token}}' },
    ])
    expect(r.requests[1]!.doc.body?.text).toBe('user=a&pass={{pass}}')
    expect(r.vars).toEqual(
      expect.arrayContaining([
        { key: 'api_key', secret: true },
        { key: 'password', secret: true },
        { key: 'client_secret', secret: true },
        { key: 'pass', secret: true },
      ])
    )
    expect(r.leftOut).toContain('X-Api-Key')
    expect(r.leftOut).toContain('the value of password')
  })

  it('reads a Postman collection: folders as collections, its variables, unusable bodies skipped', () => {
    const postman = JSON.stringify({
      info: {
        name: 'Sample shop',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [
        { key: 'base', value: 'https://shop.example.test' },
        { key: 'apiToken', value: 'sk-1' },
        { key: 'tenant', value: 'tn-2', type: 'secret' },
      ],
      item: [
        {
          name: 'Orders',
          item: [
            {
              name: 'Create order',
              request: {
                method: 'POST',
                header: [{ key: 'Content-Type', value: 'application/json' }],
                url: { raw: '{{base}}/orders?dry=1' },
                body: { mode: 'raw', raw: '{"qty":2}' },
              },
            },
            {
              name: 'Upload receipt',
              request: {
                method: 'POST',
                url: '{{base}}/receipts',
                body: { mode: 'formdata', formdata: [] },
              },
            },
          ],
        },
        { name: 'Ping', request: '{{base}}/ping' },
      ],
    })
    expect(detectFormat(postman)).toBe('postman')
    const r = importRequests(postman)
    expect(r.collection).toBe('Sample shop')
    expect(r.requests.map((x) => [x.collection, x.doc.name, x.doc.method, x.doc.url])).toEqual([
      ['Orders', 'Create order', 'POST', '{{base}}/orders'],
      [undefined, 'Ping', 'GET', '{{base}}/ping'],
    ])
    expect(r.requests[0]!.doc.body).toEqual({ format: 'json', text: '{"qty":2}' })
    expect(r.skipped).toEqual(['Upload receipt: a formdata body'])
    expect(r.vars).toEqual([
      { key: 'base', value: 'https://shop.example.test' },
      { key: 'apiToken', secret: true },
      { key: 'tenant', secret: true },
    ])
    expect(JSON.stringify(r)).not.toContain('sk-1')
    expect(JSON.stringify(r)).not.toContain('tn-2')
  })

  it('reads an Insomnia export with its groups and environment', () => {
    const insomnia = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'Sample API' },
        { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'Items' },
        {
          _id: 'env_1',
          _type: 'environment',
          parentId: 'wrk_1',
          data: { base: 'http://localhost:4000' },
        },
        {
          _id: 'env_2',
          _type: 'environment',
          parentId: 'env_1',
          isPrivate: true,
          data: { tenant: 'private-1' },
        },
        {
          _id: 'req_1',
          _type: 'request',
          parentId: 'fld_1',
          name: 'List items',
          method: 'GET',
          url: '{{ _.base }}/items',
          parameters: [{ name: 'page', value: '2' }],
          headers: [{ name: 'Accept', value: 'application/json' }],
          body: {},
        },
      ],
    })
    expect(detectFormat(insomnia)).toBe('insomnia')
    const r = importRequests(insomnia)
    expect(r.collection).toBe('Sample API')
    expect(r.requests[0]).toEqual({
      collection: 'Items',
      doc: expect.objectContaining({
        name: 'List items',
        url: '{{base}}/items',
        params: [{ key: 'page', value: '2' }],
        headers: [{ key: 'Accept', value: 'application/json' }],
      }),
    })
    expect(r.vars).toEqual([
      { key: 'base', value: 'http://localhost:4000' },
      { key: 'tenant', secret: true },
    ])
    expect(JSON.stringify(r)).not.toContain('private-1')
  })

  it('reads a Bruno collection export', () => {
    const bruno = JSON.stringify({
      name: 'Sample bruno',
      version: '1',
      items: [
        {
          type: 'folder',
          name: 'Samples',
          items: [
            {
              type: 'http-request',
              name: 'Create sample',
              request: {
                method: 'POST',
                url: '{{base}}/samples',
                headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
                params: [],
                body: { mode: 'json', json: '{"qty":2}' },
              },
            },
            { type: 'graphql-request', name: 'Query samples', request: {} },
          ],
        },
      ],
    })
    expect(detectFormat(bruno)).toBe('bruno-export')
    const r = importRequests(bruno)
    expect(r.requests.map((x) => [x.collection, x.doc.name])).toEqual([
      ['Samples', 'Create sample'],
    ])
    expect(r.skipped).toEqual(['Query samples: a graphql-request request'])
  })

  it('says plainly what it cannot read', () => {
    expect(() => importRequests('hello there')).toThrow(
      'The clipboard holds no request: paste a curl command, a .http file, or a Postman, Insomnia or Bruno export'
    )
  })
})

describe('bringing imported requests into the project', () => {
  it('makes each request under a name not taken and adds the values the environment lacks', async () => {
    const { importInto, importWords } = await import('@/requests/importInto')
    const { RequestsModel, forgetRequestSecrets } = await import('@/requests/RequestsModel')
    const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
    forgetRequestSecrets()
    const node = fakeNode()
    const model = new RequestsModel(node.rpc, 'project-1', ports())
    await model.load()
    await model.selectEnvironment('local')
    const imported = importRequests(
      [
        '@base = http://elsewhere.test',
        '@port = 4000',
        '### Create sample',
        'POST {{base}}/samples',
        'Cookie: session=abc',
        '',
      ].join('\n')
    )
    const outcome = await importInto(model, imported, 'Samples')
    expect(outcome.made).toEqual(['Samples/Create sample 2.http'])
    // The environment keeps its own base; only what it lacked is added.
    expect(outcome.vars).toEqual(['port'])
    expect(node.envs.get('local')!.vars).toContainEqual({ key: 'port', value: '4000' })
    expect(node.envs.get('local')!.vars[0]).toEqual({ key: 'base', value: 'http://localhost:4000' })
    expect(importWords(outcome, 'local')).toBe(
      'Imported 1 request into Samples. Added to local: port. Left out, as they carried credentials: Cookie. Put them back as saved keys, ${abele_key:name}.'
    )
  })
})
