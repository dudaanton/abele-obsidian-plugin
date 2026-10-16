import { expect, it } from 'vitest'
import {
  assertPullEvidence,
  firstFolderExpectedPulls,
  assertSmallPullBounds,
  smallPullCounts,
} from '../helpers/smallPullBounds'
import { emptyPullSummary, summarizePull } from '@/sync/pullOperationCounts'
import { firstFolderFixture } from '../e2e/helpers/syncFirstFolderFixture'

const operations = {
  'adapter stat': 9,
  'adapter exists': 2,
  'adapter writeBinary': 1,
  'adapter rename': 1,
  'journal save': 2,
}

it('counts reviewed attachment-kind executable requests separately from ordinary placements', () => {
  expect(
    firstFolderExpectedPulls([
      { path: 'Notes/sample.md', size: 20, kind: 'note' },
      { path: 'Notes/sample.js', size: 20, kind: 'attachment' },
      { path: 'Media/sample.bin', size: 1024 * 1024 + 1, kind: 'attachment' },
    ])
  ).toEqual({ small: 1, large: 1, requests: 4 })
})

it('requires exactly the fixture streams including the reviewed executable and two large-file chunks', () => {
  expect(
    firstFolderExpectedPulls(
      firstFolderFixture().files.map((file) => ({ path: file.path, size: file.bytes.length }))
    )
  ).toEqual({ small: 1022, large: 1, requests: 1025 })
})

it('accepts one bounded atomic write and rejects extra work or incomplete evidence', () => {
  const counts = smallPullCounts(operations, 1)
  expect(() => assertSmallPullBounds(counts)).not.toThrow()
  for (const key of ['requests', 'writes', 'publications', 'journal', 'bridge', 'native'] as const)
    expect(() => assertSmallPullBounds({ ...counts, [key]: 100 })).toThrow(key)
  expect(() => assertSmallPullBounds({ ...counts, requests: 0 })).toThrow('incomplete')
})

it('includes the central staged write in the bridge ceiling while rejecting another call', () => {
  const counts = smallPullCounts(operations, 1)
  expect(() => assertSmallPullBounds({ ...counts, bridge: 15 })).not.toThrow()
  expect(() => assertSmallPullBounds({ ...counts, bridge: 16 })).toThrow('bridge')
  // The previous create/append/seal path remains over budget on either host.
  for (const bridge of [18, 23])
    expect(() => assertSmallPullBounds({ ...counts, bridge })).toThrow('bridge')
})

it('rejects hidden per-file overhead, missing counters, repeated pulls and extra requests in summaries', () => {
  const small = emptyPullSummary()
  summarizePull(small, smallPullCounts(operations, 1))
  const evidence = {
    small,
    large: emptyPullSummary(),
    contentRequests: 1,
    failed: 0,
    overlap: false,
  }
  const expected = { small: 1, large: 0, requests: 1 }
  expect(() => assertPullEvidence(evidence, expected)).not.toThrow()
  for (const change of [
    { small: { ...small, max: { ...small.max, writes: 2 } } },
    { small: { ...small, min: { ...small.min, journal: 0 } } },
    { small: { ...small, count: 2 } },
    { contentRequests: 2 },
    { failed: 1 },
    { overlap: true },
  ])
    expect(() => assertPullEvidence({ ...evidence, ...change }, expected)).toThrow()
})
