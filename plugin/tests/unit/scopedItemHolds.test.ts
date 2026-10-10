import { afterEach, expect, it } from 'vitest'
import { tokenPublicationFixture } from '../helpers/tokenPublicationFixture'
let one: Awaited<ReturnType<typeof tokenPublicationFixture>> | undefined
afterEach(async () => {
  await one?.runtime.disconnect()
  one = undefined
})
it('retains a rejected item and its exact staged source after restarting the adapter', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockResolvedValueOnce({
    cursor: 0,
    results: [{ status: 'rejected', code: 'quota_exceeded', message: 'sample quota' }],
  })
  await one.runtime.publishAttachment('first').catch(() => {})
  const saved = JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    id: 'first',
    path: 'first.bin',
    mtime: 1000,
    bytes: [...new TextEncoder().encode('first immutable bytes')],
  })
  await one.runtime.disconnect()
  const next = one.make()
  try {
    expect(JSON.parse((await one.state.getMeta('token-asset-outbox')) ?? '[]')).toEqual(saved)
  } finally {
    await next.disconnect()
  }
})
it('an aborted durable enqueue neither vacates retained work nor sends a request', async () => {
  one = await tokenPublicationFixture()
  one.publish.mockRejectedValueOnce(new Error('sample response loss'))
  await one.runtime.publishAttachment('first').catch(() => {})
  const prior = await one.state.getMeta('token-asset-outbox'),
    save = one.state.setMeta.bind(one.state)
  one.state.setMeta = async (key, value) => {
    if (key === 'token-asset-outbox') throw new Error('sample transaction abort')
    await save(key, value)
  }
  await expect(one.runtime.publishAttachment('second')).rejects.toThrow('sample transaction abort')
  expect(await one.state.getMeta('token-asset-outbox')).toBe(prior)
  expect(one.publish).toHaveBeenCalledOnce()
})
