/**
 * Balances per account, as the finance sidebar and the account header read them.
 *
 * Built from a fake vault of account and transaction notes, so the index resolves links and
 * reads frontmatter exactly as it does in the app.
 */
import { describe, it, expect, afterEach } from 'vitest'
import dayjs from 'dayjs'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault } from '../helpers/testEnv'

const account = (name: string, accountType: string, currency?: string): FakeFileSpec => ({
  path: `Accounts/${name}.md`,
  frontmatter: { type: 'account', accountType, ...(currency ? { currency } : {}) },
})

let n = 0
const tx = (fm: Record<string, unknown>): FakeFileSpec => ({
  path: `Transactions/tx ${++n}.md`,
  frontmatter: { type: 'transaction', date: '2026-09-01', ...fm },
})

let lists: { tl: TransactionsList; al: AccountsList; bi: BalanceIndex } | null = null

function build(specs: FakeFileSpec[]) {
  useVault(specs)
  const al = new AccountsList()
  const tl = new TransactionsList()
  const bi = new BalanceIndex(tl, al)
  lists = { tl, al, bi }
  return bi
}

afterEach(() => {
  lists?.bi.cleanup()
  lists?.tl.cleanup()
  lists?.al.cleanup()
  lists = null
})

const at = dayjs('2026-09-30')

describe('BalanceIndex — transfers between wallets in different currencies', () => {
  const wallets = [account('Euro card', 'asset', 'EUR'), account('Dollar card', 'asset', 'USD')]

  it('credits the receiving wallet with the foreign amount', () => {
    const bi = build([
      ...wallets,
      tx({
        from: '[[Euro card]]',
        to: '[[Dollar card]]',
        amount: 100,
        currency: 'EUR',
        foreignAmount: 110,
        foreignCurrency: 'USD',
      }),
    ])

    expect(bi.getBalanceAtDate('Accounts/Euro card.md', at)).toBe(-100)
    expect(bi.getBalanceAtDate('Accounts/Dollar card.md', at)).toBe(110)
  })

  it('counts the receiving wallet as 0, not the sum in the other currency, when no foreign amount is given', () => {
    const bi = build([
      ...wallets,
      tx({
        from: '[[Euro card]]',
        to: '[[Dollar card]]',
        amount: 100,
        currency: 'EUR',
        foreignCurrency: 'USD',
      }),
    ])

    expect(bi.getBalanceAtDate('Accounts/Euro card.md', at)).toBe(-100)
    expect(bi.getBalanceAtDate('Accounts/Dollar card.md', at)).toBe(0)
  })

  it('does the same when the note carries no foreign currency at all', () => {
    const bi = build([
      ...wallets,
      tx({ from: '[[Euro card]]', to: '[[Dollar card]]', amount: 100, currency: 'EUR' }),
    ])

    expect(bi.getBalanceAtDate('Accounts/Euro card.md', at)).toBe(-100)
    expect(bi.getBalanceAtDate('Accounts/Dollar card.md', at)).toBe(0)
  })

  it('zeroes whichever side is not in the transaction currency', () => {
    const bi = build([
      ...wallets,
      tx({ from: '[[Euro card]]', to: '[[Dollar card]]', amount: 50, currency: 'USD' }),
    ])

    expect(bi.getBalanceAtDate('Accounts/Euro card.md', at)).toBe(0)
    expect(bi.getBalanceAtDate('Accounts/Dollar card.md', at)).toBe(50)
  })

  it('leaves same-currency transfers and expenses alone', () => {
    const bi = build([
      ...wallets,
      account('Euro cash', 'asset', 'EUR'),
      account('Food', 'expense'),
      tx({ from: '[[Euro card]]', to: '[[Euro cash]]', amount: 30, currency: 'EUR' }),
      tx({ from: '[[Dollar card]]', to: '[[Food]]', amount: 7, currency: 'USD' }),
    ])

    expect(bi.getBalanceAtDate('Accounts/Euro card.md', at)).toBe(-30)
    expect(bi.getBalanceAtDate('Accounts/Euro cash.md', at)).toBe(30)
    expect(bi.getBalanceAtDate('Accounts/Dollar card.md', at)).toBe(-7)
  })
})
