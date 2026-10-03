// @vitest-environment node
import { it, expect } from 'vitest'
import { storeOwnerUnit, loadOwnerUnit } from '@/sync/publication/ownerUnitStorage'
import type { PushUnit } from '@/sync/publication/publicationIntents'
it('reserves a constant-size selection and preserves all original JSON key order/handles', () => {
  const unit: PushUnit = {
    requestId: 'sample-request',
    ops: Array.from({ length: 1000 }, (_, i) =>
      i % 2
        ? { mtime: i, size: 1, sha: 'a'.repeat(64), path: 'Sample/' + i + '.bin', op: 'create' }
        : { op: 'create', path: 'Sample/' + i + '.bin', sha: 'a'.repeat(64), size: 1, mtime: i }
    ),
    createHandles: Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [i, 'sample-batch:' + i])
    ),
  }
  const prepared = storeOwnerUnit(unit),
    indices = Array.from({ length: 1000 }, (_, i) => i).filter((i) => i % 10 !== 0),
    actual = {
      requestId: unit.requestId,
      ops: indices.map((i) => unit.ops[i]),
      createHandles: Object.fromEntries(
        indices.map((old, index) => [index, unit.createHandles[old]])
      ),
    },
    bound = storeOwnerUnit(unit, actual, true)
  expect(JSON.stringify(bound).length).toBeLessThanOrEqual(JSON.stringify(prepared).length)
  expect(bound.m.length).toBe(prepared.m.length)
  expect(JSON.stringify(loadOwnerUnit(bound).prepared)).toBe(JSON.stringify(unit))
  expect(JSON.stringify(loadOwnerUnit(bound).actual)).toBe(JSON.stringify(actual))
  expect(JSON.stringify(storeOwnerUnit(unit, unit, true)).length).toBeLessThanOrEqual(
    JSON.stringify(prepared).length
  )
})
it('rejects invalid selections/dictionaries instead of changing receipt operations', () => {
  const unit: PushUnit = {
      requestId: 'sample',
      ops: [{ op: 'create', path: 'sample.bin', sha: 'a'.repeat(64), size: 1, mtime: 1 }],
      createHandles: { 0: 'sample:0' },
    },
    stored = storeOwnerUnit(unit)
  expect(() => loadOwnerUnit({ ...stored, m: '80', b: true })).toThrow(/range/)
  expect(() => loadOwnerUnit({ ...stored, m: '00' })).toThrow(/selection/)
  expect(() =>
    loadOwnerUnit({ ...stored, k: [['op', 'op']], o: [[0, ['create', 'create']]] })
  ).toThrow(/dictionary/)
})
