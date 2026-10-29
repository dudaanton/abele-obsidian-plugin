import { expect, it, vi } from 'vitest'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, ports } from '../helpers/requestsFakeNode'

it('shares one polling loop between the sidebar and request tabs until the last closes', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  const list = vi.spyOn(node.rpc, 'list')
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  const sidebar = model.followList(() => true)
  const first = model.followList(() => true)
  const second = model.followList(() => true)
  try {
    await vi.advanceTimersByTimeAsync(5000)
    expect(list).toHaveBeenCalledTimes(1)
    sidebar()
    first()
    await vi.advanceTimersByTimeAsync(5000)
    expect(list).toHaveBeenCalledTimes(2)
    second()
    await vi.advanceTimersByTimeAsync(10000)
    expect(list).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    sidebar()
    first()
    second()
    model.destroy()
    vi.useRealTimers()
  }
})

it('updates a project-file send and its history row when a late answer arrives', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  const send = {
    id: 'sample-file-send',
    at: '2026-01-02T03:04:05Z',
    method: 'GET',
    url: 'https://example.test',
  }
  vi.spyOn(node.rpc, 'send').mockResolvedValue({ send_id: send.id })
  const status = vi
    .spyOn(node.rpc, 'status')
    .mockResolvedValue({ send, outcome: { state: 'unknown', after_ms: 30000 } })
  const model = new RequestsModel(
    node.rpc,
    'sample-project',
    ports({
      files: {
        list: async () => ['sample.http'],
        read: async () => ({ text: 'GET https://example.test', contentId: 'sample-v1' }),
        write: async () => {},
        watch: async () => () => {},
      },
    })
  )
  await model.load()
  const id = model.files!.collections[0].requests[0].id
  await model.send(id, { interactive: true })
  const stop = model.followList(() => true)
  try {
    status.mockResolvedValue({
      send,
      outcome: {
        state: 'answered',
        response: {
          status: 200,
          ms: 45000,
          bytes: 4,
          headers: [],
          body: 'late',
        },
      },
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(model.entry(id).outcome).toMatchObject({ kind: 'answered', response: { body: 'late' } })
    expect(model.entry(id).history[0]).toMatchObject({ id: send.id, status: 200, failed: false })
    expect(node.rpc.send).toHaveBeenCalledOnce()
  } finally {
    stop()
    model.destroy()
    vi.useRealTimers()
  }
})

it('refreshes an unknown answer while open and after reopening without resending', async () => {
  vi.useFakeTimers()
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'sample-project', ports())
  const id = 'Samples/Create sample.http'
  const send = {
    id: 'sample-send',
    at: '2026-01-02T03:04:05Z',
    method: 'GET',
    url: 'https://example.test',
  }
  const status = vi.spyOn(node.rpc, 'status').mockResolvedValue({
    send,
    outcome: { state: 'unknown', after_ms: 30000 },
  })
  const history = vi.spyOn(node.rpc, 'history').mockResolvedValue([send])
  await model.load()
  await model.open(id)
  expect(model.entry(id).outcome?.kind).toBe('unknown')
  const stop = model.followList(() => true)
  try {
    status.mockResolvedValue({
      send,
      outcome: {
        state: 'answered',
        response: {
          status: 200,
          ms: 45000,
          bytes: 4,
          headers: [],
          body: 'late',
        },
      },
    })
    history.mockResolvedValue([{ ...send, status: 200, ms: 45000 }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(model.entry(id).outcome).toMatchObject({ kind: 'answered', response: { body: 'late' } })
    expect(model.entry(id).history[0].status).toBe(200)
    model.entry(id).outcome = { kind: 'unknown', after: '30 s' }
    await model.open(id)
    expect(model.entry(id).outcome?.kind).toBe('answered')
    expect(node.sent).toHaveLength(0)
  } finally {
    stop()
    model.destroy()
    vi.useRealTimers()
  }
})

it('restores a project-file request answer by send identity without storing its body or sending again', async () => {
  const node = fakeNode()
  const sendId = 's00000000000000000000000001'
  vi.spyOn(node.rpc, 'send').mockResolvedValue({ send_id: sendId })
  vi.spyOn(node.rpc, 'status').mockResolvedValue({
    send: {
      id: sendId,
      at: '2026-01-02T03:04:05.000Z',
      method: 'GET',
      url: 'https://example.test/items',
    },
    outcome: {
      state: 'answered',
      response: { status: 200, ms: 12, bytes: 13, headers: [], body: 'sample answer' },
    },
  })
  const shared = ports({
    files: {
      list: async () => ['sample.http'],
      read: async () => ({ text: 'GET https://example.test/items', contentId: 'sample-v1' }),
      write: async () => {},
      watch: async () => () => {},
    },
  })
  const first = new RequestsModel(node.rpc, 'sample-project', shared)
  await first.load()
  const id = first.files!.collections[0].requests[0].id
  await first.send(id, { interactive: true })
  first.destroy()
  const restored = new RequestsModel(node.rpc, 'sample-project', shared)
  try {
    await restored.open(id)
    expect(restored.entry(id).outcome).toMatchObject({
      kind: 'answered',
      response: { body: 'sample answer' },
    })
    expect(shared.prefs.get(`answer:${id}`)).toBe(sendId)
    expect(node.rpc.send).toHaveBeenCalledOnce()
  } finally {
    restored.destroy()
  }
})

it('restores saved request answers from node history after a new model is created', async () => {
  const node = fakeNode()
  const first = new RequestsModel(node.rpc, 'sample-project', ports())
  const id = 'Samples/Create sample.http'
  await first.load()
  await first.send(id, { interactive: true })
  first.destroy()
  const restored = new RequestsModel(node.rpc, 'sample-project', ports())
  try {
    await restored.open(id)
    expect(restored.entry(id).outcome).toMatchObject({
      kind: 'answered',
      response: { status: 201 },
    })
    expect(node.sent).toHaveLength(1)
  } finally {
    restored.destroy()
  }
})
