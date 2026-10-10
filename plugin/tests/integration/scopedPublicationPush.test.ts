import { afterEach, expect, it } from 'vitest'
import { tokenPublicationFixture } from '../helpers/tokenPublicationFixture'
let one: Awaited<ReturnType<typeof tokenPublicationFixture>> | undefined
afterEach(async () => {
  await one?.runtime.disconnect()
  one = undefined
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
