import { describe, expect, it } from 'vitest'
import { walletAmount, type WalletTransaction } from '@/entities/walletAmount'

const base: WalletTransaction = {
  amount: 100,
  currency: 'EUR',
  foreignAmount: null,
  foreignCurrency: null,
}

describe('walletAmount — the signed amount each side actually holds', () => {
  // History: 23357f69 (foreign amount on the from side), 2ef41e7e (categories),
  // 8ac23eac (an unspecified conversion must not invent money).
  it.each([
    {
      name: 'category ignores foreign amount',
      wallet: null,
      other: 'USD',
      patch: { foreignAmount: 110, foreignCurrency: 'USD' },
      from: -100,
      to: 100,
    },
    {
      name: 'foreign currency matches either side',
      wallet: 'USD',
      other: 'EUR',
      patch: { foreignAmount: 110, foreignCurrency: 'USD' },
      from: -110,
      to: 110,
    },
    {
      name: 'zero foreign amount is not missing',
      wallet: 'USD',
      other: 'EUR',
      patch: { foreignAmount: 0, foreignCurrency: 'USD' },
      from: -0,
      to: 0,
    },
    {
      name: 'primary currency matches either side',
      wallet: 'EUR',
      other: 'USD',
      patch: {},
      from: -100,
      to: 100,
    },
    { name: 'missing foreign amount', wallet: 'USD', other: 'EUR', patch: {}, from: 0, to: 0 },
    {
      name: 'foreign amount without a currency',
      wallet: 'USD',
      other: 'EUR',
      patch: { foreignAmount: 110 },
      from: -110,
      to: 110,
    },
    {
      name: 'foreign amount in an unrelated currency',
      wallet: 'USD',
      other: 'EUR',
      patch: { foreignAmount: 110, foreignCurrency: 'GBP' },
      from: 0,
      to: 0,
    },
    {
      name: 'no primary currency assumes the from wallet',
      wallet: 'EUR',
      other: 'USD',
      patch: { currency: null },
      from: -100,
      to: 0,
    },
    {
      name: 'no currencies on transaction, conversion supplied',
      wallet: 'EUR',
      other: 'USD',
      patch: { currency: null, foreignAmount: 110 },
      from: -100,
      to: 110,
    },
    {
      name: 'same-currency wallets use primary amount',
      wallet: 'EUR',
      other: 'EUR',
      patch: {},
      from: -100,
      to: 100,
    },
    {
      name: 'unknown other wallet uses primary amount',
      wallet: 'USD',
      other: null,
      patch: {},
      from: -100,
      to: 100,
    },
    {
      name: 'matching foreign currency takes precedence over primary',
      wallet: 'EUR',
      other: 'EUR',
      patch: { foreignAmount: 75, foreignCurrency: 'EUR' },
      from: -75,
      to: 75,
    },
    {
      name: 'negative amount reverses direction',
      wallet: 'EUR',
      other: null,
      patch: { amount: -7.25 },
      from: 7.25,
      to: -7.25,
    },
  ])('$name', ({ wallet, other, patch, from, to }) => {
    const tx = { ...base, ...patch }
    expect(walletAmount(tx, wallet, other, 'from')).toBe(from)
    expect(walletAmount(tx, wallet, other, 'to')).toBe(to)
    expect(tx).toEqual({ ...base, ...patch })
  })
})
