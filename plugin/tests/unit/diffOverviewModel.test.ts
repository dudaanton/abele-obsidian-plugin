import { expect, it } from 'vitest'
import { overviewChanges, overviewLine } from '@/components/diffOverviewModel'

it('maps added, removed and replaced chunks to working-file line ranges', () => {
  expect(overviewChanges('first\nold\nlast', 'first\nnew\nlast')).toEqual([
    { from: 2, to: 2, kind: 'changed' },
  ])
  expect(overviewChanges('first\nlast', 'first\nadded\nlast')[0]).toEqual({
    from: 2,
    to: 2,
    kind: 'added',
  })
  expect(overviewChanges('first\nremoved\nlast', 'first\nlast')[0]).toEqual({
    from: 2,
    to: 2,
    kind: 'removed',
  })
  expect(overviewChanges('same', 'same')).toEqual([])
})

it('clamps navigation from click and drag to real working lines', () => {
  expect(overviewLine(-1, 200)).toBe(1)
  expect(overviewLine(0.5, 200)).toBe(101)
  expect(overviewLine(1.5, 200)).toBe(200)
  expect(overviewLine(0.5, 1)).toBe(1)
})
