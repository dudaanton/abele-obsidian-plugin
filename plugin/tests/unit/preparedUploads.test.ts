import { expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { PreparedUploads } from '@/sync/preparedUploads'

const one = { path: 'Shared/sample.bin', sha: 'a'.repeat(64), size: 12 }
it('keeps new in-flight hints bounded even when stale unfinished hints remain', async () => {
  const state = new MemoryStateStore()
  const uploads = new PreparedUploads(state, () => 'same')
  const second = { ...one, path: 'Shared/second.bin', sha: 'b'.repeat(64) }
  const third = { ...one, path: 'Shared/third.bin', sha: 'c'.repeat(64) }
  await uploads.begin(one)
  await uploads.begin(second)
  await uploads.begin(third)
  expect(await new PreparedUploads(state, () => 'same').pending()).toEqual([second, third])
})
it('retains acknowledged blobs and only unfinished sources across runtime loss', async () => {
  const state = new MemoryStateStore()
  const first = new PreparedUploads(state, () => 'principal:generation')
  await first.begin(one)
  await first.acknowledge(one.sha)
  await first.begin({ ...one, sha: 'b'.repeat(64), path: 'Shared/next.bin' })
  const resumed = new PreparedUploads(state, () => 'principal:generation')
  expect(await resumed.known(one.sha)).toBe(true)
  expect(await resumed.pending()).toEqual([
    { ...one, sha: 'b'.repeat(64), path: 'Shared/next.bin' },
  ])
  await resumed.spend([one.sha])
  expect(await new PreparedUploads(state, () => 'principal:generation').known(one.sha)).toBe(false)
})
it('does not reuse receipts after principal/generation changes or expiry', async () => {
  const state = new MemoryStateStore()
  let context = 'first',
    now = 1000
  const receipts = new PreparedUploads(
    state,
    () => context,
    () => now
  )
  await receipts.begin(one)
  await receipts.acknowledge(one.sha)
  context = 'second'
  expect(await receipts.known(one.sha)).toBe(false)
  expect(await receipts.pending()).toEqual([])
  context = 'first'
  now += 24 * 60 * 60 * 1000
  expect(await receipts.known(one.sha)).toBe(false)
})

it('does not refresh a receipt when observed later and retires before an uncertain commit', async () => {
  const state = new MemoryStateStore()
  let now = 1000
  const receipts = new PreparedUploads(
    state,
    () => 'same',
    () => now
  )
  await receipts.begin(one)
  await receipts.acknowledge(one.sha, 0)
  now = 22 * 60 * 60 * 1000
  expect(await receipts.known(one.sha)).toBe(true)
  now = 23 * 60 * 60 * 1000
  expect(await receipts.known(one.sha)).toBe(false)
  await receipts.acknowledge(one.sha)
  await receipts.spend([one.sha])
  // A commit response can be lost after the server consumed the prepared grant.
  expect(
    await new PreparedUploads(
      state,
      () => 'same',
      () => now
    ).known(one.sha)
  ).toBe(false)
})
