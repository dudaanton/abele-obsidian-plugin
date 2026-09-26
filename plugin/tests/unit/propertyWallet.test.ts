/**
 * A property linking to a wallet shows its balance today; one linking to anything else does not.
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { walletBalance, type WalletAccount, type WalletSource } from '@/properties/wallet'

const accounts: Record<string, WalletAccount> = {
  'Finance/Accounts/Cash.md': { accountType: 'asset', currency: 'EUR' },
  'Finance/Accounts/Card.md': { accountType: 'liability', currency: 'USD' },
  'Finance/Accounts/Food.md': { accountType: 'expense', currency: 'EUR' },
}
const balances: Record<string, number> = {
  'Finance/Accounts/Cash.md': 1234.5,
  'Finance/Accounts/Card.md': -80,
  'Finance/Accounts/Food.md': 300,
}

const source: WalletSource = {
  resolve: (linkpath) => {
    const path = `Finance/Accounts/${linkpath.split('/').pop()}.md`
    return accounts[path] ? path : linkpath === 'Note' ? 'Note.md' : null
  },
  account: (path) => accounts[path] ?? null,
  balance: (path) => balances[path] ?? 0,
}

const today = dayjs('2026-09-26')

describe('walletBalance', () => {
  it('shows what an asset holds, in its currency', () => {
    const b = walletBalance('[[Finance/Accounts/Cash|Cash]]', 'Tx.md', source, today)
    expect(b?.path).toBe('Finance/Accounts/Cash.md')
    expect(b?.text).toMatch(/^1.?234\.50 EUR$/)
    expect(b?.negative).toBe(false)
  })

  it('marks a debt as below zero', () => {
    const b = walletBalance('[[Card]]', 'Tx.md', source, today)
    expect(b?.negative).toBe(true)
    expect(b?.text).toMatch(/USD$/)
  })

  it('shows nothing for a spending category, a note, or words that are not a link', () => {
    expect(walletBalance('[[Food]]', 'Tx.md', source, today)).toBeNull()
    expect(walletBalance('[[Note]]', 'Tx.md', source, today)).toBeNull()
    expect(walletBalance('Cash', 'Tx.md', source, today)).toBeNull()
    expect(walletBalance(12, 'Tx.md', source, today)).toBeNull()
  })
})
