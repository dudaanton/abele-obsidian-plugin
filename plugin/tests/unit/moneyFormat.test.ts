/**
 * How an amount is written out.
 *
 * One rule beyond two decimal places, and it is the reason this exists: a zero never wears a
 * minus sign. An account whose transactions cancel out lands on a residue like -1.4e-14 —
 * ordinary floating point, the sum of adding and subtracting the same money — and rounding
 * that to two places gives `-0.00`, which reads as a balance in the red. Javascript's own -0
 * formats with the sign too.
 */
import { describe, it, expect } from 'vitest'
import { formatAmount } from '@/helpers/moneyFormat'

describe('an amount that is really zero', () => {
  it('is written without a sign when the arithmetic left a negative crumb', () => {
    expect(formatAmount(-1.4210854715202004e-14)).toBe('0.00')
  })

  it('is written without a sign when it is javascript’s own negative zero', () => {
    expect(formatAmount(-0)).toBe('0.00')
  })

  it('is written without a sign when it rounds to zero from below', () => {
    expect(formatAmount(-0.004)).toBe('0.00')
  })

  it('is a plain zero when it is a plain zero', () => {
    expect(formatAmount(0)).toBe('0.00')
  })
})

describe('an amount that is not zero', () => {
  it('keeps its minus sign', () => {
    expect(formatAmount(-500)).toBe('-500.00')
  })

  it('keeps a minus sign that survives the rounding', () => {
    expect(formatAmount(-0.006)).toBe('-0.01')
  })

  it('is given two decimal places whether it had them or not', () => {
    expect(formatAmount(6.8)).toBe('6.80')
    expect(formatAmount(12)).toBe('12.00')
  })

  it('is rounded to two rather than truncated', () => {
    expect(formatAmount(1.006)).toBe('1.01')
    expect(formatAmount(1.004)).toBe('1.00')
  })

  it('leaves a large one whole', () => {
    expect(formatAmount(1234567.891)).toContain('567.89')
  })
})
