import { describe, expect, it } from 'vitest'
import { financeDirections, transactionKind } from '@/finance/accountTypes'

describe('mixed account transaction classification', () => {
  it.each(['asset', 'liability'] as const)('counts both directions against %s', (wallet) => {
    expect(financeDirections('mixed', wallet)).toEqual({ income: true, expense: false })
    expect(transactionKind('mixed', wallet)).toBe('income')
    expect(financeDirections(wallet, 'mixed')).toEqual({ income: false, expense: true })
    expect(transactionKind(wallet, 'mixed')).toBe('expense')
  })

  it('keeps mixed-to-mixed transfers neutral', () => {
    expect(financeDirections('mixed', 'mixed')).toEqual({ income: false, expense: false })
    expect(transactionKind('mixed', 'mixed')).toBe('transfer')
  })

  it.each(['computed', null, 'unknown'])('does not treat %s as a wallet', (other) => {
    expect(transactionKind('mixed', other)).toBe('transfer')
    expect(transactionKind(other, 'mixed')).toBe('transfer')
  })

  it('preserves existing category directions, including expense precedence', () => {
    expect(transactionKind('revenue', 'mixed')).toBe('income')
    expect(transactionKind('mixed', 'expense')).toBe('expense')
    expect(financeDirections('revenue', 'expense')).toEqual({ income: true, expense: true })
    expect(transactionKind('revenue', 'expense')).toBe('expense')
    expect(transactionKind('asset', 'asset')).toBe('transfer')
  })
})
