// Project authorization has its own tests; these cases exercise request/trace behavior.
vi.mock('@/ai/tools/node/projectAccess', () => ({ nodeProjectGuard: async () => () => {} }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequestTools } from '@/ai/tools/RequestTools'
import { forgetRequestSecrets, RequestsModel } from '@/requests/RequestsModel'
import { doc, fakeNode, ports } from '../helpers/requestsFakeNode'

beforeEach(() => forgetRequestSecrets())

function setup(over: Parameters<typeof ports>[0] = {}) {
  const node = fakeNode()
  const p = ports(over)
  const model = new RequestsModel(node.rpc, 'project-1', p)
  const tools = createRequestTools(() => ({ model, project: 'sample-project' }))
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const tool = tools.find((t) => t.name === name)!
    return (await tool.execute('call-1', params)).content[0]!.text
  }
  return { node, p, model, tools, call }
}

describe('the agent’s tools over saved requests', () => {
  it('imports a curl line into a collection, leaving its credential out', async () => {
    const { call, node } = setup()
    const said = await call('http_import', {
      text: "curl -H 'Authorization: Bearer sk-sample-1' https://api.example.test/v1/items",
      collection: 'Items',
    })
    expect(said).toContain('Imported 1 request into Items.')
    expect(said).toContain('Left out, as they carried credentials: Authorization.')
    expect(node.files.get('Items/GET -v1-items.http')).toMatchObject({
      method: 'GET',
      url: 'https://api.example.test/v1/items',
      headers: [],
    })
    expect(JSON.stringify([...node.files.values()])).not.toContain('sk-sample-1')
  })

  it('names in its answer what an import skipped and why', async () => {
    const { call } = setup()
    const said = await call('http_import', {
      text: JSON.stringify({
        info: {
          name: 'Sample',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          { name: 'Ping', request: 'https://api.example.test/ping' },
          {
            name: 'Upload',
            request: { method: 'POST', url: 'https://api.example.test/u', body: { mode: 'file' } },
          },
        ],
      }),
    })
    expect(said).toContain('Imported 1 request into Sample; 1 skipped.')
    expect(said).toContain('Skipped:\n  Upload: a file body')
  })

  it('says plainly when no project’s requests are open', async () => {
    const tools = createRequestTools(() => undefined)
    await expect(tools[0]!.execute('call-1', {})).rejects.toThrow(/open Requests/)
  })

  it('lists the requests with the environments, and reads one with its last sends', async () => {
    const { call, model } = setup()
    const list = await call('http_requests')
    expect(list).toContain('Project sample-project. Environment: local (also staging)')
    expect(list).toContain('Samples/Create sample.http · POST {{base}}/samples')
    await model.send('Samples/Create sample.http', { interactive: true })
    const read = await call('http_request_read', { id: 'Samples/Create sample.http' })
    expect(read).toContain('Create sample · POST {{base}}/samples')
    expect(read).toContain('Authorization: Bearer ${abele_key:sample-key}')
    expect(read).toMatch(/Last sends:\n {2}s\d+ · .* · local · 201/)
  })

  it('makes a request and replaces one, keys only by name', async () => {
    const { call, node } = setup()
    expect(
      await call('http_request_save', {
        collection: 'Orders',
        name: 'Place order',
        method: 'post',
        url: '{{base}}/orders',
        headers: [{ key: 'X-Key', value: '${abele_key:sample-key}' }],
        body: '{"qty":1}',
        checks: ['status == 201'],
      })
    ).toBe('Made Orders/Place order.http.')
    expect(node.files.get('Orders/Place order.http')).toMatchObject({
      method: 'POST',
      body: { format: 'json', text: '{"qty":1}' },
      checks: ['status == 201'],
    })
    await call('http_request_save', {
      id: 'Orders/Place order.http',
      name: 'Place order',
      method: 'GET',
      url: '{{base}}/orders/1',
    })
    expect(node.files.get('Orders/Place order.http')!.method).toBe('GET')
    await expect(
      call('http_request_save', { name: 'x', method: 'BREW', url: '/' })
    ).rejects.toThrow('Not a method: BREW')
  })

  it('sends without asking the person anything and answers within its ceiling', async () => {
    const { call, node, p } = setup()
    const answer = await call('http_send', { id: 'Samples/Create sample.http' })
    expect(answer).toMatch(/^Send s\d+ in local\.\n201 Created · 12 ms/)
    expect(answer).toContain('Checks: ✓ status == 201')
    expect(answer).toContain('tok-from-answer')
    expect(p.keys.prepare).toHaveBeenCalledWith(expect.anything(), false, undefined)
    expect(node.sent).toHaveLength(1)
    const sendId = /Send (s\d+)/.exec(answer)![1]
    expect(
      await call('http_send_result', { id: 'Samples/Create sample.http', send: sendId })
    ).toContain('201 Created')
  })

  it('switches to the environment it names, and refuses one that is not there', async () => {
    const { call, node, model } = setup()
    await call('http_send', { id: 'Samples/Create sample.http', environment: 'staging' })
    expect(model.state.environment).toBe('staging')
    expect(node.sent[0]!.url).toBe('https://staging.test/samples')
    await expect(
      call('http_send', { id: 'Samples/Create sample.http', environment: 'nowhere' })
    ).rejects.toThrow('No environment named nowhere')
  })

  it('takes only request ids and collections inside the requests folder', async () => {
    const { call, node } = setup()
    for (const id of ['../outside.http', '/etc/x.http', 'Samples/.hidden.http', 'Samples/x.txt'])
      await expect(call('http_request_read', { id })).rejects.toThrow('Not a request id')
    await expect(
      call('http_request_save', { collection: '../up', name: 'x', method: 'GET', url: '/' })
    ).rejects.toThrow('Not a collection name')
    await expect(
      call('http_request_save', {
        name: 'x',
        method: 'GET',
        url: '/',
        script_before: 'Sign\nGET https://elsewhere.test/',
      })
    ).rejects.toThrow('Not a script name')
    expect([...node.files.keys()].some((k) => k.includes('..'))).toBe(false)
  })

  it('refuses a send its script moves to another address', async () => {
    const run = vi.fn(async () => ({ request: { url: 'https://elsewhere.test/collect' } }))
    const { call, node } = setup({ scripts: { run } })
    node.files.set('Samples/Create sample.http', doc({ scripts: { before: 'Redirect it' } }))
    await expect(call('http_send', { id: 'Samples/Create sample.http' })).rejects.toThrow(
      'sends this request to another address'
    )
    expect(node.sent).toEqual([])
  })

  it('stops at a key not yet allowed at the address, instead of asking', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('A key in this request is not allowed at http://localhost:4000 yet.')
    })
    const { call, node } = setup({ keys: { has: () => true, prepare } })
    await expect(call('http_send', { id: 'Samples/Create sample.http' })).rejects.toThrow(
      'not allowed'
    )
    expect(node.sent).toEqual([])
  })

  it('never takes a secret no person has sent anywhere yet', async () => {
    const { call, node, model } = setup()
    node.files.set(
      'Samples/Create sample.http',
      doc({ headers: [{ key: 'X-Token', value: '{{token}}' }] })
    )
    await model.load()
    model.setSecret('token', 'typed-1')
    await expect(call('http_send', { id: 'Samples/Create sample.http' })).rejects.toThrow(
      'has not been sent anywhere yet'
    )
  })
})
