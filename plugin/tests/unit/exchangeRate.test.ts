/**
 * The exchange rate in the transaction dialog. A transfer between wallets in two currencies
 * has an amount on each side; the rate is what ties them, and the one to start from is the
 * rate last used between the same two currencies in the vault — nothing is fetched.
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { rateBetween, applyRate, lastUsedRate } from '@/helpers/exchangeRate'

describe('rateBetween / applyRate', () => {
  it('is what one unit of the first currency buys of the second', () => {
    expect(rateBetween(100, 108.5)).toBe(1.085)
  })

  it('has no rate without both sides', () => {
    expect(rateBetween(0, 10)).toBeNull()
    expect(rateBetween(10, null)).toBeNull()
  })

  it('turns an amount into the other currency, to the cent', () => {
    expect(applyRate(100, 1.0853)).toBe(108.53)
    expect(applyRate(null, 1.1)).toBeNull()
  })
})

describe('lastUsedRate', () => {
  const tx = (date: string, currency: string, amount: number, fc: string, fa: number) => ({
    date: dayjs(date),
    currency,
    amount,
    foreignCurrency: fc,
    foreignAmount: fa,
  })

  it('takes the latest transaction between the pair', () => {
    const rate = lastUsedRate(
      [
        tx('2026-01-01', 'EUR', 100, 'USD', 105),
        tx('2026-03-01', 'EUR', 100, 'USD', 110),
        tx('2026-02-01', 'EUR', 100, 'USD', 108),
      ],
      'EUR',
      'USD'
    )
    expect(rate).toEqual({ rate: 1.1, date: '2026-03-01' })
  })

  it('reads a transaction the other way round as the inverse rate', () => {
    const rate = lastUsedRate([tx('2026-01-01', 'USD', 110, 'EUR', 100)], 'EUR', 'USD')
    expect(rate?.rate).toBe(1.1)
  })

  it('ignores other pairs and incomplete ones', () => {
    expect(
      lastUsedRate(
        [tx('2026-01-01', 'EUR', 100, 'GBP', 85), tx('2026-02-01', 'EUR', 0, 'USD', 10)],
        'EUR',
        'USD'
      )
    ).toBeNull()
  })
})
