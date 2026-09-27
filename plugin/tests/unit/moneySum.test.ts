/**
 * Money added up in whole units of its smallest decimal, so the app's balances and totals are
 * the decimals the notes say, never float residue: 0.1 + 0.2 is 0.3 here, and a balance of
 * 1000 − 0.1 − 0.2 is 999.7, not 999.6999999999999.
 */
import { describe, it, expect, afterEach } from 'vitest'
import dayjs from 'dayjs'
import { addMoney, sumMoney } from '@/helpers/moneySum'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { Account } from '@/entities/Account'
import { currencyCard } from '@/helpers/financeTotals'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

describe('addMoney', () => {
  it('adds what floats get wrong', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addMoney(0.1, 0.2)).toBe(0.3)
    expect(addMoney(1000, -0.1)).toBe(999.9)
    expect(sumMoney(Array.from({ length: 10000 }, () => 0.01))).toBe(100)
    expect(sumMoney([-5000, 162.67, -535.57])).toBe(-5372.9)
    expect(addMoney(0.00012345, 1)).toBe(1.00012345)
  })

  it('still adds numbers too large to count in small units', () => {
    expect(addMoney(1e15, 1)).toBe(1e15 + 1)
  })
})

describe('the app’s own money sums', () => {
  let lists: { tl: TransactionsList; al: AccountsList; bi: BalanceIndex } | null = null
  afterEach(() => {
    lists?.bi.cleanup()
    lists?.tl.cleanup()
    lists?.al.cleanup()
    lists = null
  })

  it('keeps a balance on the cent', () => {
    let n = 0
    const tx = (amount: number, from: string, to: string): FakeFileSpec => ({
      path: `T/${++n}.md`,
      frontmatter: {
        type: 'transaction',
        date: '2026-01-02',
        from: `[[${from}]]`,
        to: `[[${to}]]`,
        amount,
        currency: 'EUR',
      },
    })
    useVault([
      {
        path: 'A/Card.md',
        frontmatter: { type: 'account', accountType: 'asset', currency: 'EUR' },
      },
      { path: 'A/Pay.md', frontmatter: { type: 'account', accountType: 'revenue' } },
      { path: 'A/Food.md', frontmatter: { type: 'account', accountType: 'expense' } },
      tx(0.1, 'Pay', 'Card'),
      tx(0.2, 'Pay', 'Card'),
      tx(0.1, 'Card', 'Food'),
      tx(0.2, 'Pay', 'Food'),
    ])
    const al = new AccountsList()
    const tl = new TransactionsList()
    const bi = new BalanceIndex(tl, al)
    lists = { tl, al, bi }
    const end = dayjs('2026-01-31')
    // In floats: 0.1 + 0.2 − 0.1 = 0.20000000000000004
    expect(bi.getBalanceAtDate('A/Card.md', end)).toBe(0.2)
    expect(bi.getNetWorthAtDate(end)).toBe(0.2)
    expect(bi.getNetWorthAtDateByCurrency(end, 'EUR')).toBe(0.2)
    // 0.1 + 0.2 = 0.30000000000000004 in floats
    expect(bi.getBalanceAtDateByCurrency('A/Food.md', end, 'EUR')).toBe(0.3)
    expect(
      bi.getTotalForPeriod({
        startDate: dayjs('2026-01-01'),
        endDate: end,
        categoryPath: undefined,
        accountPath: 'A/Food.md',
        direction: 'to',
      })
    ).toBe(0.3)
  })

  it('adds the currency cards on the cent', () => {
    const map = new Map<string, Account>()
    const balances = new Map<string, number>()
    ;[0.1, 0.2, 0.4].forEach((b, i) => {
      const a = new Account({ wikilink: `[[A${i}]]` })
      a.accountType = 'asset'
      a.currency = 'EUR'
      map.set(`A${i}.md`, a)
      balances.set(`A${i}.md`, b)
    })
    const card = currencyCard('EUR', map, (p) => balances.get(p) ?? 0)
    expect(card.assets).toBe(0.7)
    expect(card.net).toBe(0.7)
  })
})
