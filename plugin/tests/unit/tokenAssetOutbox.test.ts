import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { TokenAssetOutbox } from '@/sync/tokenAssetOutbox'

async function fixture() {
  const state = new MemoryStateStore(),
    bytes = new Uint8Array([1, 2, 3])
  const input = {
    id: 'local-file',
    path: 'Private/sample.png',
    bytes,
    sha: await sha256(bytes),
    mtime: 10,
  }
  const receipt = {
    cursor: 1,
    results: [
      {
        status: 'applied',
        seq: 1,
        path: input.path,
        sha: input.sha,
        size: 3,
        mtime: 10,
        file_id: 'remote-file',
        version_id: 'remote-version',
      },
    ],
  }
  const send = vi.fn(
    async (one: { key: string; path: string; sha: string; mtime: number }, bytes: Uint8Array) => {
      requests.push({
        key: one.key,
        path: one.path,
        sha: one.sha,
        mtime: one.mtime,
        bytes: bytes.slice(),
      })
      return receipt
    }
  )
  const requests: unknown[] = []
  const options = {
    state,
    binding: () => 'source',
    assertOwned: () => {},
    serial: async <T>(work: () => Promise<T>) => work(),
    approved: async () => true,
    send,
    changed: () => {},
    maxBytes: () => 2,
  }
  return { state, input, send, options, requests, receipt }
}
it('refuses an oversized item before any upload and exposes a clear state', async () => {
  const one = await fixture(),
    outbox = new TokenAssetOutbox(one.options)
  await expect(outbox.enqueue(one.input)).rejects.toThrow('too large')
  expect(outbox.state()[0].reason).toContain('too large')
  await outbox.drain()
  expect(one.send).not.toHaveBeenCalled()
})
it.each([{ path: 'Private/other.png' }, { sha: 'a'.repeat(64) }, { size: 4 }, { mtime: 11 }])(
  'retains the request when a receipt belongs to different content: %j',
  async (changed) => {
    const one = await fixture(),
      options = { ...one.options, maxBytes: () => 100 }
    const outbox = new TokenAssetOutbox(options),
      key = await outbox.enqueue(one.input)
    one.send.mockResolvedValueOnce({
      ...one.receipt,
      results: [{ ...one.receipt.results[0], ...changed }],
    })
    await expect(outbox.drain(false, key)).rejects.toThrow('does not match')
    expect(await one.state.get(one.input.path)).toBeNull()
    expect(outbox.state()).toHaveLength(1)
    expect(outbox.state()[0].key).toBe(key)
  }
)
it('reopens a lost response with the exact request and attempts it once per pass', async () => {
  const one = await fixture(),
    options = { ...one.options, maxBytes: () => 100 }
  const outbox = new TokenAssetOutbox(options)
  const key = await outbox.enqueue(one.input)
  const send = one.send.getMockImplementation()!
  one.send.mockImplementationOnce(async (...args) => {
    await send(...args)
    throw new Error('Response lost')
  })
  await expect(outbox.drain(false, key)).rejects.toThrow('Response lost')
  expect(one.send).toHaveBeenCalledTimes(1)
  const reopened = new TokenAssetOutbox(options)
  await reopened.restore()
  await reopened.drain(false, key)
  expect(one.send).toHaveBeenCalledTimes(2)
  expect(one.requests[1]).toEqual(one.requests[0])
  await reopened.drain()
  expect(one.send).toHaveBeenCalledTimes(2)
  expect(reopened.state()).toEqual([])
})

it('replays an uncertain request with its original key and body after the server size limit drops', async () => {
  const one = await fixture()
  let limit = 100
  const options = { ...one.options, maxBytes: () => limit },
    outbox = new TokenAssetOutbox(options),
    key = await outbox.enqueue(one.input),
    send = one.send.getMockImplementation()!
  const loseResponse = async (...args: Parameters<typeof send>) => {
    await send(...args)
    throw new Error('Response lost')
  }
  one.send.mockImplementationOnce(loseResponse).mockImplementationOnce(loseResponse)
  await expect(outbox.drain(false, key)).rejects.toThrow('Response lost')
  limit = 2
  const reopened = new TokenAssetOutbox(options)
  await reopened.restore()
  await expect(reopened.drain(false, key)).rejects.toThrow('Response lost')
  expect(one.send).toHaveBeenCalledTimes(2)
  expect(one.requests[1]).toEqual(one.requests[0])
  expect(reopened.state()).toEqual([{ path: one.input.path, key, reason: 'Response lost' }])
  limit = 100
  await reopened.drain(true)
  expect(one.send).toHaveBeenCalledTimes(3)
  expect(one.requests[2]).toEqual(one.requests[0])
  expect(reopened.state()).toEqual([])
})
