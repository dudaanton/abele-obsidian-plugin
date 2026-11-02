import { expect, it } from 'vitest'
import {
  countUses,
  isSelectValue,
  offer,
  optionOf,
  pick,
  selectFor,
  selectValues,
  unpick,
  type SelectProperty,
} from '@/properties/select'

const property: SelectProperty = {
  key: 'stage',
  multiple: false,
  options: [
    { value: 'Ready', icon: 'check', color: 'green', description: 'Can begin' },
    { value: 'Waiting', description: 'Needs another step' },
  ],
}

it('matches configured keys and values without case, not by substrings', () => {
  expect(selectFor([property], ' STAGE ')).toBe(property)
  expect(selectFor([property], 'stages')).toBeNull()
  expect(selectFor(undefined, 'stage')).toBeNull()
  expect(optionOf(property, ' ready ')).toBe(property.options[0])
  expect(optionOf(property, 'old')).toBeNull()
})

it('offers options in order and searches descriptions, excluding held multiple values', () => {
  expect(offer(property, 'Ready', '')).toEqual(property.options)
  expect(offer(property, null, 'BEGIN')).toEqual([property.options[0]])
  expect(offer({ ...property, multiple: true }, ['ready'], '')).toEqual([property.options[1]])
})

it('writes names only and preserves unknown multiple values exactly as written', () => {
  const multi = { ...property, multiple: true }
  expect(pick(property, null, 'Ready')).toBe('Ready')
  expect(pick(multi, ['  legacy  ', 'Waiting'], 'Ready')).toEqual([
    '  legacy  ',
    'Waiting',
    'Ready',
  ])
  expect(pick(multi, ['ready'], 'Ready')).toEqual(['ready'])
  expect(unpick(multi, ['  legacy  ', 'Ready'], 'ready')).toEqual(['  legacy  '])
  expect(unpick(property, 'Ready', 'ready')).toBeNull()
  expect(selectValues('  legacy  ')).toEqual(['  legacy  '])
})

it('accepts only compatible values, leaving malformed data to the native widget', () => {
  for (const value of [null, undefined, '', 4, ['Ready', 3]])
    expect(isSelectValue(value)).toBe(true)
  for (const value of [false, {}, [null], ['Ready', {}]]) expect(isSelectValue(value)).toBe(false)
})

it('counts notes rather than repeated occurrences without modifying frontmatter', () => {
  const notes = [{ Stage: ['Ready', 'ready'] }, { stage: 'READY' }, { other: 'Ready' }, undefined]
  const before = JSON.stringify(notes)
  expect(countUses(() => notes, 'stage', 'Ready')).toBe(2)
  expect(JSON.stringify(notes)).toBe(before)
})
