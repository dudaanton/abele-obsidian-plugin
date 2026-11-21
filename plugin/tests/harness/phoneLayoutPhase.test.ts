import { expect, it } from 'vitest'
import { phoneLayoutDialogs } from '../e2e/helpers/phoneLayoutPhase'

it('partitions the catalogue without dropping, duplicating or reordering states', () => {
  const sync = [
    ...Array.from({ length: 11 }, (_, index) => `sync-sections-${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `sync-check-${index + 1}`),
  ]
  const original = ['confirm', ...sync, 'sync-connect', 'sync-check-extra', 'picker']
  expect(phoneLayoutDialogs(original, true)).toEqual(sync)
  expect(phoneLayoutDialogs(original, false)).toEqual([
    'confirm',
    'sync-connect',
    'sync-check-extra',
    'picker',
  ])
  expect(
    new Set([...phoneLayoutDialogs(original, true), ...phoneLayoutDialogs(original, false)]).size
  ).toBe(original.length)
})
