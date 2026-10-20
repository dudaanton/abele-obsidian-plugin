import { afterEach, expect, it, vi } from 'vitest'
import { tokenPublicationFixture } from '../helpers/tokenPublicationFixture'
import { deferred } from '../helpers/deferred'
import { sha256 } from '@abele/sync-sdk/core'
let one: Awaited<ReturnType<typeof tokenPublicationFixture>> | undefined
it('published rename eligibility survives restart but cannot follow an unrelated replacement', async () => {
  one = await tokenPublicationFixture()
  await one.runtime.publishAttachment('first')
  await one.runtime.disconnect()
  one.targets.set('first', { id: 'first', path: 'renamed.bin', kind: 'attachment' })
  const restarted = one.make()
  try {
    await restarted.client.prepare(one.files, one.state)
    expect(restarted.client.includes('renamed.bin')).toBe(true)
    expect(restarted.client.includes('second.bin')).toBe(false)
    one.targets.delete('first')
    await restarted.client.prepare(one.files, one.state)
    expect(restarted.client.includes('renamed.bin')).toBe(false)
  } finally {
    await restarted.disconnect()
  }
})
afterEach(async () => {
  await one?.runtime.disconnect()
  one = undefined
})
it('a held rejected item never starves a later attachment or ordinary receive', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockResolvedValueOnce({
    cursor: 0,
    results: [{ status: 'rejected', code: 'quota_exceeded', message: 'sample quota' }],
  })
  await expect(one.runtime.publishAttachment('first')).rejects.toMatchObject({
    code: 'quota_exceeded',
  })
  await expect(one.runtime.publishAttachment('second')).resolves.toBeUndefined()
  const pending = JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')
  expect(pending).toHaveLength(1)
  expect(pending[0].id).toBe('first')
  expect(one.publish.mock.calls.map((args) => args[0])).toEqual(['first.bin', 'second.bin'])
  const before = one.wire.mock.calls.length
  await one.runtime.engine.sync()
  expect(one.wire.mock.calls.length).toBeGreaterThan(before)
})
it('enqueue during an unresolved request cannot be erased by the earlier receipt cleanup', async () => {
  one = await tokenPublicationFixture()
  const gate = deferred<void>(),
    original = one.publish.getMockImplementation()!
  one.publish.mockImplementation(async (...args) => {
    await gate.promise
    return original(...args)
  })
  const first = one.runtime.publishAttachment('first')
  await new Promise<void>((resolve) => {
    const poll = () => (one!.publish.mock.calls.length ? resolve() : setTimeout(poll, 1))
    poll()
  })
  const second = one.runtime.publishAttachment('second')
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
  expect(
    JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')
      .map((item: { id: string }) => item.id)
      .sort()
  ).toEqual(['first', 'second'])
  gate.resolve()
  await Promise.all([first, second])
  expect(one.publish.mock.calls.map((args) => args[0])).toEqual(['first.bin', 'second.bin'])
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual([])
})
it('simultaneous approvals of the same immutable candidate send one request', async () => {
  one = await tokenPublicationFixture()
  await Promise.all([
    one.runtime.publishAttachment('first'),
    one.runtime.publishAttachment('first'),
  ])
  expect(one.publish).toHaveBeenCalledOnce()
})
it('shutdown waits for an already sent publication and retains its exact request for the next adapter', async () => {
  one = await tokenPublicationFixture()
  const gate = deferred<void>(),
    send = one.publish.getMockImplementation()!
  one.publish.mockImplementationOnce(async (...args) => {
    await gate.promise
    return send(...args)
  })
  const request = one.runtime.publishAttachment('first').catch((error) => error)
  await vi.waitFor(() => expect(one!.publish).toHaveBeenCalledOnce())
  let closed = false
  const closing = one.runtime.disconnect().then(() => {
    closed = true
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
  expect(closed).toBe(false)
  const captured = one.publish.mock.calls[0]
  gate.resolve()
  await closing
  expect(await request).toBeInstanceOf(Error)
  const pending = JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({
    path: captured[0],
    bytes: [...captured[1]],
    mtime: captured[2],
    key: captured[3],
  })
})
it('publishes a decomposed local filename with its canonical wire spelling and keeps its local identity', async () => {
  one = await tokenPublicationFixture()
  const physical = 'Cafe\u0301.bin',
    wire = physical.normalize('NFC')
  await one.files.move('first.bin', physical)
  await one.files.writeAtomic(wire, new TextEncoder().encode('unrelated sibling'), 2000)
  one.targets.set('first', { id: 'first', path: physical, kind: 'attachment' })
  await one.runtime.publishAttachment('first')
  expect(one.publish.mock.calls[0][0]).toBe(wire)
  expect(await one.state.get(physical)).toMatchObject({ path: physical, wirePath: wire })
  expect(new TextDecoder().decode(await one.files.read(wire))).toBe('unrelated sibling')
})
it('an uncertain item retains its request while an unrelated attachment finishes', async () => {
  one = await tokenPublicationFixture()
  const send = one.publish.getMockImplementation()!
  one.publish.mockImplementation((...args) =>
    args[0] === 'first.bin' ? Promise.reject(new Error('sample uncertain request')) : send(...args)
  )
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow('sample uncertain request')
  const original = one.publish.mock.calls[0]
  await expect(one.runtime.publishAttachment('second')).resolves.toBeUndefined()
  expect(await one.state.get('second.bin')).toMatchObject({ fileId: 'file-second.bin' })
  const pending = JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')
  expect(pending.map((item: { id: string }) => item.id)).toEqual(['first'])
  expect(
    one.publish.mock.calls
      .filter((args) => args[0] === 'first.bin')
      .every((args) => JSON.stringify(args) === JSON.stringify(original))
  ).toBe(true)
})
it('a later candidate of an uncertain file remains visibly pending instead of reporting success', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockRejectedValue(new Error('sample unresolved receipt'))
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow('sample unresolved receipt')
  const original = one.publish.mock.calls[0]
  await one.files.writeAtomic('first.bin', new TextEncoder().encode('later candidate'), 2000)
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow(/pending|confirmation/i)
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toHaveLength(2)
  expect(
    one.publish.mock.calls.every((args) => JSON.stringify(args) === JSON.stringify(original))
  ).toBe(true)
})
it('retry of a known refusal uses a fresh key but the original immutable source', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockResolvedValueOnce({
    cursor: 0,
    results: [{ status: 'rejected', code: 'quota_exceeded', message: 'sample quota' }],
  })
  await expect(one.runtime.publishAttachment('first')).rejects.toMatchObject({
    code: 'quota_exceeded',
  })
  const original = one.publish.mock.calls[0]
  await one.files.writeAtomic('first.bin', new TextEncoder().encode('later local bytes'), 2000)
  await one.runtime.sync()
  expect(one.publish.mock.calls[1].slice(0, 3)).toEqual(original.slice(0, 3))
  expect(one.publish.mock.calls[1][3]).not.toBe(original[3])
  expect(await one.state.get('first.bin')).toMatchObject({ mtime: 1000 })
})
it('a local edit during capture causes no publication of mixed or unrecorded bytes', async () => {
  one = await tokenPublicationFixture()
  const read = one.files.read.bind(one.files)
  let changed = false
  one.files.read = async (path) => {
    const bytes = await read(path)
    if (!changed && path === 'first.bin') {
      changed = true
      await one!.files.writeAtomic(path, new TextEncoder().encode('different local bytes'), 2000)
    }
    return bytes
  }
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow(/changed during/i)
  expect(one.publish).not.toHaveBeenCalled()
  expect(await one.state.getMeta('token-asset-outbox')).toBeNull()
})
it('a late publication receipt cannot downgrade a newer received baseline', async () => {
  one = await tokenPublicationFixture()
  const gate = deferred<void>(),
    send = one.publish.getMockImplementation()!
  one.publish.mockImplementationOnce(async (...args) => {
    await gate.promise
    return send(...args)
  })
  const request = one.runtime.publishAttachment('first')
  await new Promise<void>((resolve) => {
    const poll = () => (one!.publish.mock.calls.length ? resolve() : setTimeout(poll, 1))
    poll()
  })
  const newerBytes = new TextEncoder().encode('newer received bytes')
  await one.files.writeAtomic('first.bin', newerBytes, 5000)
  const latest = {
    path: 'first.bin',
    wirePath: 'first.bin',
    fileId: 'file-first.bin',
    versionId: 'newer-version',
    sha: await sha256(newerBytes),
    size: newerBytes.length,
    mtime: 5000,
  }
  await one.state.put(latest)
  gate.resolve()
  await request
  expect(await one.state.get('first.bin')).toEqual(latest)
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual([])
})
it('a malformed durable publication queue fails closed before uploading any source', async () => {
  one = await tokenPublicationFixture()
  await one.state.setMeta('token-asset-outbox', '{invalid')
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow()
  expect(await one.state.getMeta('token-asset-outbox')).toBe('{invalid')
  expect(one.publish).not.toHaveBeenCalled()
})
it('a denied explicit publication creates no request, durable outbox or upload', async () => {
  one = await tokenPublicationFixture(false)
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow(/approved/i)
  expect(one.publish).not.toHaveBeenCalled()
  expect(await one.state.getMeta('token-asset-outbox')).toBeNull()
})
it('response loss retains immutable bytes and the same request key for retry', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockRejectedValueOnce(new Error('sample response loss'))
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow('sample response loss')
  const request = one.publish.mock.calls[0]
  await one.files.writeAtomic('first.bin', new TextEncoder().encode('new local version'), 2000)
  await one.runtime.sync()
  expect(one.publish.mock.calls[1]).toEqual(request)
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual([])
})
it('a commit whose follow-up fetch fails is not classified as a refused publication', async () => {
  one = await tokenPublicationFixture()
  one.wire.mockRejectedValue(new Error('sample follow-up failure'))
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow()
  expect(one.publish).toHaveBeenCalledOnce()
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual([])
  expect(await one.state.get('first.bin')).toMatchObject({
    fileId: 'file-first.bin',
    versionId: 'version-first.bin',
    mtime: 1000,
  })
})
it('an uncertain request survives adapter restart and a local rename with its original path and key', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockRejectedValueOnce(new Error('sample receipt lost'))
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow('sample receipt lost')
  const original = one.publish.mock.calls[0],
    send = one.publish.getMockImplementation()!
  await one.runtime.disconnect()
  await one.files.move('first.bin', 'renamed.bin')
  one.targets.set('first', { id: 'first', path: 'renamed.bin', kind: 'attachment' })
  const restarted = one.make()
  const publish = (await import('vitest')).vi
    .spyOn(restarted.client, 'publishGroupAsset')
    .mockImplementation(send)
  try {
    await restarted.sync()
    expect(publish.mock.calls[0]).toEqual(original)
    expect(await one.state.get('first.bin')).toMatchObject({
      fileId: 'file-first.bin',
      versionId: 'version-first.bin',
    })
    expect(await one.files.read('renamed.bin')).toEqual(original[1])
  } finally {
    await restarted.disconnect()
  }
})
it('a lost acknowledgement of durable cleanup retries the identical settled request', async () => {
  one = await tokenPublicationFixture()
  const save = one.state.setMeta.bind(one.state)
  one.state.setMeta = async (key, value) => {
    if (key === 'token-asset-outbox' && value === '[]') {
      one!.state.setMeta = save
      throw new Error('sample cleanup failure')
    }
    await save(key, value)
  }
  await expect(one.runtime.publishAttachment('first')).rejects.toThrow('sample cleanup failure')
  const first = one.publish.mock.calls[0]
  await one.runtime.sync()
  expect(one.publish.mock.calls[1]).toEqual(first)
  expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual([])
})
