import { expect, it } from 'vitest'
import { selectionLayout } from '@/maps/core/selection'

const places = [
  { id: 'one', path: 'One.md', title: 'One', lat: 12, lon: 20, properties: [] },
  { id: 'two', path: 'Two.md', title: 'Two', lat: 12, lon: 20, properties: [] },
  { id: 'three', path: 'Three.md', title: 'Three', lat: 13, lon: 21, properties: [] },
]
it('keeps a selected coincident place separate from the remaining group without changing coordinates', () => {
  const result = selectionLayout(places, 'one', true)
  expect(result.place).toBe(places[0])
  expect(result.points).toEqual(places.slice(1))
  expect(result.offset).toEqual([0, -48])
  expect(result.place).toMatchObject({ lat: 12, lon: 20 })
  expect(places).toHaveLength(3)
})
it('keeps the true position when grouping is off or there is no coincident place', () => {
  expect(selectionLayout(places, 'one', false).offset).toEqual([0, 0])
  expect(selectionLayout(places, 'three', true).offset).toEqual([0, 0])
  expect(selectionLayout(places, 'missing', true)).toMatchObject({ points: places, offset: [0, 0] })
})

it('keeps separated selection inside the viewport near the top edge', () => {
  expect(
    selectionLayout(places, 'one', true, () => ({
      point: { x: 50, y: 10 },
      width: 100,
      height: 200,
    })).offset
  ).toEqual([0, 48])
})
it('uses the available horizontal room in a shallow embedded map', () => {
  expect(
    selectionLayout(places, 'one', true, () => ({
      point: { x: 150, y: 50 },
      width: 300,
      height: 100,
    })).offset
  ).toEqual([48, 0])
})
