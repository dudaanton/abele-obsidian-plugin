import { expect, it, vi } from 'vitest'
import { lazyArray } from '@/helpers/lazyArray'

it('does no eager parsing and preserves the complete mutable array interface on first use', () => {
  const create = vi.fn(() => [1, 2, 3])
  const rows = lazyArray(create)
  expect(Array.isArray(rows)).toBe(true)
  expect(create).not.toHaveBeenCalled()
  expect(rows.map((one) => one * 2)).toEqual([2, 4, 6])
  expect([...rows]).toEqual([1, 2, 3])
  rows.push(4)
  expect(Object.keys(rows)).toEqual(['0', '1', '2', '3'])
  expect(Object.getOwnPropertyDescriptor(rows, 'length')?.value).toBe(4)
  rows.length = 1
  expect(rows.slice()).toEqual([1])
  expect(create).toHaveBeenCalledTimes(1)
})
