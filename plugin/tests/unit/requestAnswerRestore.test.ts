import { expect, it, vi } from 'vitest'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, ports } from '../helpers/requestsFakeNode'

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
