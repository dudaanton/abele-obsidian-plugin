/**
 * The accounts in the transaction dialog: which ones are offered for each side, and what the
 * transaction will do to a wallet's balance.
 */
import { describe, it, expect } from 'vitest'
import { Account, type AccountType } from '@/entities/Account'
import { walletOptions, walletEffect, holdsBalance } from '@/helpers/walletContext'

function accounts(specs: Array<[string, AccountType, string?]>): Map<string, Account> {
  const map = new Map<string, Account>()
  for (const [path, type, currency] of specs) {
    const account = new Account({ wikilink: `[[${path}]]` })
    account.accountType = type
    account.currency = currency ?? null
    map.set(path, account)
  }
  return map
}

const all = accounts([
  ['Accounts/Card.md', 'asset', 'EUR'],
  ['Accounts/Cash USD.md', 'asset', 'USD'],
  ['Accounts/Groceries.md', 'expense'],
  ['Accounts/Salary.md', 'revenue'],
  ['Accounts/Loan.md', 'liability', 'EUR'],
  ['Accounts/All money.md', 'computed', 'EUR'],
])

describe('walletOptions', () => {
  it('offers wallets first for money leaving, spending first for money arriving', () => {
    expect(walletOptions(all, '', 'from').map((o) => o.name)).toEqual([
      'Card',
      'Cash USD',
      'Loan',
      'Salary',
      'Groceries',
    ])
    expect(walletOptions(all, '', 'to')[0].name).toBe('Groceries')
  })

  it('never offers a computed account, which no transaction can touch', () => {
    expect(walletOptions(all, 'money', 'from')).toEqual([])
  })

  it('narrows to names holding the query, those starting with it first', () => {
    expect(walletOptions(all, 'ca', 'to').map((o) => o.name)).toEqual(['Card', 'Cash USD'])
    expect(walletOptions(all, 'ar', 'from').map((o) => o.name)).toEqual(['Card', 'Salary'])
  })

  it('links an account the way the plugin links accounts everywhere else', () => {
    const [card] = walletOptions(all, 'Card', 'from')
    expect(card).toMatchObject({
      path: 'Accounts/Card.md',
      link: '[[Accounts/Card|Card]]',
      currency: 'EUR',
      type: 'asset',
    })
  })
})

describe('walletEffect', () => {
  const values = { amount: 100, foreignAmount: 108, foreignCurrency: 'USD' }

  it('takes the amount out of where it leaves and puts it where it arrives', () => {
    expect(walletEffect('from', values, 'EUR')).toBe(-100)
    expect(walletEffect('to', { ...values, foreignCurrency: null }, 'EUR')).toBe(100)
  })

  it('moves a wallet in the second currency by the second amount', () => {
    expect(walletEffect('to', values, 'USD')).toBe(108)
  })

  it('says nothing before there is an amount', () => {
    expect(
      walletEffect('from', { amount: null, foreignAmount: null, foreignCurrency: null }, 'EUR')
    ).toBeNull()
  })
})

describe('holdsBalance', () => {
  it('is true for wallets and debts only', () => {
    expect(holdsBalance('asset')).toBe(true)
    expect(holdsBalance('liability')).toBe(true)
    expect(holdsBalance('expense')).toBe(false)
    expect(holdsBalance(null)).toBe(false)
  })
})
