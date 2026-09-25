/**
 * The amount field of the transaction dialog is a calculator: `12.5 + 3*2` is a sum, the way a
 * receipt is added up while it is being typed in. Nothing here runs `eval` — the field parses
 * arithmetic and nothing else.
 */
import { describe, it, expect } from 'vitest'
import { evaluateAmount, isArithmetic } from '@/helpers/calculator'

describe('evaluateAmount', () => {
  it.each([
    ['42', 42],
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['1 234,50', 1234.5],
    ['12.5 + 3*2', 18.5],
    ['100 − 20 × 2', 60],
    ['10 ÷ 4', 2.5],
    ['(1 + 2) * 3', 9],
    ['-5 + 10', 5],
    ['0.1 + 0.2', 0.3],
    ['2 * -3', -6],
    ['10 / 3', 3.33333333],
  ])('%s is %d', (text, expected) => {
    expect(evaluateAmount(text)).toBe(expected)
  })

  it.each(['', '  ', '1 +', '(2', '2)', 'abc', '1 / 0', 'alert(1)', '1..2', '2 ** 3'])(
    '%j is not an amount',
    (text) => {
      expect(evaluateAmount(text)).toBeNull()
    }
  )
})

describe('isArithmetic', () => {
  it('tells a sum from a plain number', () => {
    expect(isArithmetic('12 + 3')).toBe(true)
    expect(isArithmetic('4×2')).toBe(true)
    expect(isArithmetic('12.5')).toBe(false)
    expect(isArithmetic('-12.5')).toBe(false)
    expect(isArithmetic('')).toBe(false)
  })
})
