import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
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
it('retains an NFD physical candidate and source locator across restart while recording an NFC receipt', async () => {
  const one = await fixture()
  const path = 'й-folder/ё-image.png'.normalize('NFD')
  const source = 'й-folder'.normalize('NFD') + '/.sample-stage.tmp'
  const openSource = vi.fn(async () => ({
    size: one.input.bytes.length,
    read: async (offset: number, length: number) => one.input.bytes.slice(offset, offset + length),
    assertUnchanged: async () => {},
    close: async () => {},
  }))
  const sendSource = vi.fn(async () => ({
    ...one.receipt,
    results: [{ ...one.receipt.results[0], path: path.normalize('NFC') }],
  }))
  const options = { ...one.options, maxBytes: () => 100, openSource, sendSource }
  const outbox = new TokenAssetOutbox(options)
  await outbox.enqueue({
    ...one.input,
    path,
    bytes: new Uint8Array(),
    source: { id: source, size: 3 },
  })
  const saved = await one.state.getMeta('token-asset-outbox')
  expect(JSON.parse(saved!)[0]).toMatchObject({ path, source: { id: source } })
  const reopened = new TokenAssetOutbox(options)
  await reopened.restore()
  await reopened.drain()
  expect(openSource).toHaveBeenCalledWith(source)
  expect(await one.state.get(path)).toMatchObject({ path, wirePath: path.normalize('NFC') })
})
it('retains a source locator across restart and sends the same immutable request after a lost answer', async () => {
  const one = await fixture()
  const openSource = vi.fn(async () => ({
    size: one.input.bytes.length,
    read: async (offset: number, length: number) => one.input.bytes.slice(offset, offset + length),
    assertUnchanged: async () => {},
    close: async () => {},
  }))
  const sendSource = vi.fn(async () => one.receipt)
  sendSource.mockRejectedValueOnce(new Error('answer lost'))
  const options = { ...one.options, maxBytes: () => 100, openSource, sendSource }
  const first = new TokenAssetOutbox(options)
  const key = await first.enqueue({
    ...one.input,
    bytes: new Uint8Array(),
    source: { id: '.abele-sync-sample00.tmp', size: 3 },
  })
  await expect(first.drain(false, key)).rejects.toThrow('answer lost')
  const next = new TokenAssetOutbox(options)
  await next.restore()
  await next.drain(false, key)
  expect(
    sendSource.mock.calls.map((args) => (args as unknown as [{ key: string }])[0].key)
  ).toEqual([key, key])
  expect(one.send).not.toHaveBeenCalled()
  expect(await one.state.get(one.input.path)).toMatchObject({ size: 3, sha: one.input.sha })
})
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
it('restores inside an exclusive engine cycle while a sent publication waits to be recorded', async () => {
  const one = await fixture()
  // The engine's exclusive lane: a cycle and the outbox's recording never run together.
  let lane: Promise<unknown> = Promise.resolve()
  let waiting = 0
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    waiting++
    const next = lane.then(work)
    lane = next.then(
      () => {},
      () => {}
    )
    return next
  }
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  let sent!: () => void
  const sending = new Promise<void>((resolve) => (sent = resolve))
  const send = vi.fn(async () => {
    sent()
    await answered
    return one.receipt
  })
  const outbox = new TokenAssetOutbox({ ...one.options, maxBytes: () => 100, serial, send })
  const key = await outbox.enqueue(one.input)
  const drained = outbox.drain(false, key)
  await sending
  // A sync cycle holds the engine when the answer arrives; recording it waits for the
  // cycle, and the cycle's handshake then restores the outbox.
  let handshake!: () => void
  const handshaking = new Promise<void>((resolve) => (handshake = resolve))
  const cycle = serial(async () => {
    await handshaking
    await outbox.restore()
    return 'restored'
  })
  const before = waiting
  answer()
  await vi.waitFor(() => expect(waiting).toBeGreaterThan(before))
  handshake()
  const settled = await Promise.race([
    Promise.all([cycle, drained]).then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('deadlocked'), 1000)),
  ])
  expect(settled).toBe('settled')
  expect(await one.state.get(one.input.path)).toMatchObject({ sha: one.input.sha })
})
