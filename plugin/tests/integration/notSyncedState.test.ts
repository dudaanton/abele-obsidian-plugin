import { expect, it, vi } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { NotSyncedState } from '@/sync/notSyncedState'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'
import { deferred } from '../helpers/deferred'

it('reads each durable reason without scanning file contents, survives restart, and clears resolved rows', async () => {
  const state = new MemoryStateStore()
  await state.setMeta(
    'file-retry:large.bin',
    JSON.stringify({
      path: 'large.bin',
      phase: 'push',
      reason: 'too_large: size limit',
      attempts: 1,
      nextAt: 100,
      quarantined: true,
    })
  )
  await state.setMeta(
    'file-retry:quota.md',
    JSON.stringify({
      path: 'quota.md',
      phase: 'push',
      reason: 'quota_exceeded: quota',
      attempts: 1,
      nextAt: 100,
      quarantined: false,
    })
  )
  await state.setMeta(
    'pull-held:sample-id',
    JSON.stringify({ change: { path: 'held.md', file_id: 'sample-id' } })
  )
  await state.setMeta(
    'file-retry:name',
    JSON.stringify({
      path: 'Notes/sample:part.md',
      phase: 'pull',
      reason: 'unsupported-host-name: :',
      attempts: 1,
      nextAt: 0,
      quarantined: true,
    })
  )
  await state.setMeta(
    'v2-directories',
    JSON.stringify({
      refused: [
        {
          path: 'Folder',
          direction: 'pull',
          code: 'conflict',
          message: 'Directory identity changed',
        },
      ],
    })
  )
  const all = vi.spyOn(state, 'all')
  const list = new NotSyncedState(state)
  const first = await list.snapshot()
  expect(first.map((row) => [row.path, row.kind])).toEqual([
    ['Folder', 'held'],
    ['held.md', 'held'],
    ['large.bin', 'too-large'],
    ['Notes/sample:part.md', 'name'],
    ['quota.md', 'waiting'],
  ])
  expect(await new NotSyncedState(state).snapshot()).toEqual(first)
  expect(all).not.toHaveBeenCalled()
  await state.setMeta('file-retry:large.bin', null)
  await state.setMeta('file-retry:quota.md', null)
  await state.setMeta('file-retry:name', null)
  await state.setMeta('pull-held:sample-id', null)
  await state.setMeta('v2-directories', null)
  list.invalidate()
  expect(await list.snapshot()).toEqual([])
})

it('caches a thousand-row projection and propagates unreadable metadata', async () => {
  const state = new MemoryStateStore()
  for (let n = 0; n < 1243; n++)
    await state.setMeta(
      `file-retry:sample-${n}`,
      JSON.stringify({ path: `sample-${n}`, phase: 'recovery', reason: 'local file changed' })
    )
  const list = new NotSyncedState(state)
  const first = await list.snapshot()
  const read = vi.spyOn(state, 'getMeta')
  expect(await list.snapshot()).toBe(first)
  expect(first).toHaveLength(1243)
  expect(read).not.toHaveBeenCalled()
  list.invalidate()
  read.mockRejectedValueOnce(new Error('sample unavailable metadata'))
  await expect(list.snapshot()).rejects.toThrow('sample unavailable metadata')
})

it('does not write or reread metadata for successful paths that were never refused', async () => {
  const state = new MemoryStateStore()
  const list = new NotSyncedState(state)
  await list.snapshot()
  const read = vi.spyOn(state, 'getMeta'),
    write = vi.spyOn(state, 'setMeta')
  for (let n = 0; n < 1000; n++) await list.resolved(`sample-${n}.md`)
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})
it('clears a retained refusal when the ledger already proves that exact content and date synced', async () => {
  const state = new MemoryStateStore()
  const list = new NotSyncedState(state)
  const expected = { sha: 'a'.repeat(64), size: 5, mtime: 17 }
  list.recordRefusal('sample.md', 'quota_exceeded: quota', expected)
  expect(await list.snapshot()).toHaveLength(1)
  await state.put({
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'sample-version',
    ...expected,
  })
  list.invalidate()
  expect(await list.snapshot()).toEqual([])
})

it('includes metadata that changes while a projection is being read', async () => {
  const state = new MemoryStateStore()
  const row = (path: string) => JSON.stringify({ path, phase: 'pull', reason: 'local edit' })
  await state.setMeta('file-retry:first', row('first'))
  const gate = deferred<void>(),
    entered = deferred<void>()
  const read = state.getMeta.bind(state)
  vi.spyOn(state, 'getMeta').mockImplementation(async (key) => {
    if (key === 'file-retry:first') {
      entered.resolve()
      await gate.promise
    }
    return read(key)
  })
  const list = new NotSyncedState(state)
  const reading = list.snapshot()
  await entered.promise
  await state.setMeta('file-retry:second', row('second'))
  list.invalidate()
  gate.resolve()
  expect((await reading).map((row) => row.path)).toEqual(['first', 'second'])
})
it('shows held recovery files rather than private operation identifiers and preserves direction', async () => {
  const state = new MemoryStateStore()
  for (const [owner, path, direction] of [
    ['pull-write:sample-in', 'incoming.md', 'in'],
    ['push-receipt:sample-out', 'outgoing.md', 'out'],
  ]) {
    await state.setMeta(owner, JSON.stringify({ wirePath: path, path }))
    await state.setMeta(
      'file-retry:' + encodeURIComponent(owner),
      JSON.stringify({
        path: owner,
        owner,
        phase: 'recovery',
        reason: 'Local file changed',
        direction,
      })
    )
  }
  expect(
    (await new NotSyncedState(state).snapshot()).map((row) => [row.path, row.direction])
  ).toEqual([
    ['incoming.md', 'in'],
    ['outgoing.md', 'out'],
  ])
})

it('retains the list when the production ledger closes and a new runtime opens it', async () => {
  const fixture = await tokenBuildFixture()
  try {
    await fixture.store.setMeta(
      'file-retry:sample.bin',
      JSON.stringify({
        path: 'sample.bin',
        phase: 'push',
        reason: 'quota_exceeded: quota',
        attempts: 1,
        nextAt: 100,
        quarantined: false,
      })
    )
    fixture.store.close()
    const first = await fixture.build()
    const rows = await first.runtime.notSynced()
    expect(rows).toContainEqual(expect.objectContaining({ path: 'sample.bin', kind: 'waiting' }))
    await first.host.close()
    const next = await fixture.build()
    expect(await next.runtime.notSynced()).toEqual(rows)
  } finally {
    await fixture.close()
    vi.restoreAllMocks()
  }
})

it('R31 retries only the selected path and retains the other retry schedule', async () => {
  const fixture = await tokenBuildFixture()
  try {
    const waiting = (path: string) => ({
      path,
      phase: 'push',
      reason: 'quota_exceeded: quota',
      attempts: 2,
      nextAt: Date.now() + 1000000,
      quarantined: true,
    })
    const first = waiting('first.md'),
      second = waiting('second.md')
    await fixture.store.setMeta('file-retry:first.md', JSON.stringify(first))
    await fixture.store.setMeta('file-retry:second.md', JSON.stringify(second))
    fixture.store.close()
    const built = await fixture.build()
    const retry = Reflect.get(built.engine, Symbol.for('abele.sync.retry-paths-v1'))
    expect(typeof retry).toBe('function')
    // The fixture intentionally has no network; scheduling must persist before the attempt.
    await built.runtime.retryNotSynced(['first.md']).catch(() => {})
    expect(JSON.parse((await built.store.getMeta('file-retry:first.md'))!)).toMatchObject({
      path: 'first.md',
      nextAt: 0,
      quarantined: false,
    })
    expect(JSON.parse((await built.store.getMeta('file-retry:second.md'))!)).toEqual(second)
  } finally {
    await fixture.close()
    vi.restoreAllMocks()
  }
})
