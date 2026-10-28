import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/ai/tools/node/projectAccess', () => ({ nodeProjectGuard: async () => () => {} }))
import { createRequestTools } from '@/ai/tools/RequestTools'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, ports } from '../helpers/requestsFakeNode'

afterEach(() => vi.useRealTimers())

it('ends a never-answering Requests list with a clear timeout', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  vi.spyOn(node.rpc, 'list').mockImplementation(() => new Promise(() => {}))
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  const tool = createRequestTools(() => ({ model, project: 'Sample' }))[0]!
  const result = expect(tool.execute('sample-call', {})).rejects.toThrow(/timed out/i)
  await vi.advanceTimersByTimeAsync(30001)
  await result
})

it('Stop ends a never-answering Requests list immediately', async () => {
  const node = fakeNode()
  vi.spyOn(node.rpc, 'list').mockImplementation(() => new Promise(() => {}))
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  const tool = createRequestTools(() => ({ model, project: 'Sample' }))[0]!
  const stop = new AbortController()
  const result = expect(tool.execute('sample-call', {}, stop.signal)).rejects.toThrow(/stopped/i)
  stop.abort()
  await result
})

it('bounds a send still reporting sending by its configured request timeout', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  await model.load()
  const id = 'Samples/Create sample.http'
  model.setTimeout(id, 1000)
  vi.spyOn(node.rpc, 'status').mockImplementation(() => new Promise(() => {}))
  const tool = createRequestTools(() => ({ model, project: 'Sample' })).find(
    (t) => t.name === 'http_send'
  )!
  const result = expect(tool.execute('sample-call', { id })).rejects.toThrow(
    /timed out.*may have.*Send ID: s/i
  )
  await vi.advanceTimersByTimeAsync(2001)
  await result
  expect(node.sent).toHaveLength(1)
  expect(node.sent[0].timeout_ms).toBe(1000)
  expect(model.state.sending).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it('does not cancel a concurrent caller using the same project model', async () => {
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  await model.load()
  const tool = createRequestTools(() => ({ model, project: 'Sample' }))[0]!
  const stop = new AbortController()
  stop.abort()
  await expect(tool.execute('stopped', {}, stop.signal)).rejects.toThrow(/stopped/i)
  expect((await tool.execute('continuing', {})).content[0].text).toContain('Samples')
})

it('also bounds resolving a project before its model is available', async () => {
  vi.useFakeTimers()
  const tool = createRequestTools(() => new Promise(() => {}))[0]!
  const result = expect(tool.execute('sample-call', {})).rejects.toThrow(/timed out/i)
  await vi.advanceTimersByTimeAsync(30001)
  await result
  expect(vi.getTimerCount()).toBe(0)
})

it.fails('BUG: Stop cancels the in-flight HTTP request on the node', async () => {
  // The installed node protocol has no HTTP cancellation method; retain this guarantee.
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  await model.load()
  const stop = new AbortController()
  const status = vi.spyOn(node.rpc, 'status').mockImplementation(() => new Promise(() => {}))
  const tool = createRequestTools(() => ({ model, project: 'Sample' })).find(
    (t) => t.name === 'http_send'
  )!
  const result = tool
    .execute('sample-call', { id: 'Samples/Create sample.http' }, stop.signal)
    .catch(() => {})
  await vi.waitFor(() => expect(status).toHaveBeenCalled())
  stop.abort()
  await result
  expect(node.calls).toContain('http.v1.send.cancel')
})

it('waits for a forty-five-second answer when the invocation allows sixty seconds', async () => {
  vi.useFakeTimers()
  const node = fakeNode(),
    model = new RequestsModel(node.rpc, 'sample-project', ports())
  await model.load()
  const status = node.rpc.status.bind(node.rpc)
  vi.spyOn(node.rpc, 'status').mockImplementationOnce(async (project, send) => {
    await new Promise((resolve) => window.setTimeout(resolve, 45000))
    await status(project, send)
    return status(project, send)
  })
  const tool = createRequestTools(() => ({ model, project: 'Sample' })).find(
    (t) => t.name === 'http_send'
  )!
  const result = tool.execute('sample-call', {
    id: 'Samples/Create sample.http',
    timeout_ms: 60000,
  })
  await vi.advanceTimersByTimeAsync(45001)
  expect((await result).content[0].text).toContain('201 Created')
  expect(node.sent).toHaveLength(1)
  expect(node.sent[0].timeout_ms).toBe(60000)
  expect(vi.getTimerCount()).toBe(0)
})
