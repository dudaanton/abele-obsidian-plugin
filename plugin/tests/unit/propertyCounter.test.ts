/**
 * A counter property: a number with − and + beside it. An empty or missing value counts as 0,
 * a number written as text counts as that number, and anything else is not a counter's value —
 * the buttons leave it alone rather than write over it.
 */
import { describe, it, expect } from 'vitest'
import { counterKeys, counterValue, isCounterKey, stepCounter } from '@/properties/counter'

describe('stepping a counter', () => {
  it('adds and takes one from a number', () => {
    expect(stepCounter(4, 1)).toBe(5)
    expect(stepCounter(4, -1)).toBe(3)
    expect(stepCounter(0, -1)).toBe(-1)
  })

  it('counts an empty value as 0', () => {
    expect(stepCounter('', 1)).toBe(1)
    expect(stepCounter('  ', -1)).toBe(-1)
    expect(stepCounter(null, 1)).toBe(1)
  })

  it('counts a missing value as 0', () => {
    expect(stepCounter(undefined, 1)).toBe(1)
    expect(stepCounter(undefined, -1)).toBe(-1)
  })

  it('reads a number written as text', () => {
    expect(stepCounter('7', 1)).toBe(8)
    expect(stepCounter(' 2.5 ', -1)).toBe(1.5)
  })

  it('keeps a fraction clean', () => {
    expect(stepCounter(0.1, 1)).toBe(1.1)
    expect(stepCounter(1.1, -1)).toBe(0.1)
  })

  it('leaves what is not a number alone', () => {
    expect(stepCounter('many', 1)).toBeNull()
    expect(stepCounter(true, 1)).toBeNull()
    expect(stepCounter(['1'], 1)).toBeNull()
    expect(stepCounter({ n: 1 }, 1)).toBeNull()
    expect(stepCounter(Number.NaN, 1)).toBeNull()
  })
})

describe('what a counter shows', () => {
  it('is empty for an empty value and the number otherwise', () => {
    expect(counterValue(null)).toBe(0)
    expect(counterValue(undefined)).toBe(0)
    expect(counterValue('')).toBe(0)
    expect(counterValue(3)).toBe(3)
    expect(counterValue('3')).toBe(3)
    expect(counterValue('three')).toBeNull()
  })
})

describe('which properties are counters', () => {
  it('matches names whatever their case, trimmed', () => {
    const keys = counterKeys([' Reps', 'glasses ', ''])
    expect(isCounterKey('reps', keys)).toBe(true)
    expect(isCounterKey('GLASSES', keys)).toBe(true)
    expect(isCounterKey('rep', keys)).toBe(false)
    expect(isCounterKey('', keys)).toBe(false)
  })
})
