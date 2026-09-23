import { describe, it, expect } from 'vitest'
import { Account, type AccountType } from '@/entities/Account'
import { currencyCard } from '@/helpers/financeTotals'

function accounts(
  specs: Array<{ name: string; type: AccountType; currency?: string; balance: number }>
) {
  const map = new Map<string, Account>()
  const balances = new Map<string, number>()
  for (const s of specs) {
    const a = new Account({ wikilink: `[[${s.name}]]` })
    a.accountType = s.type
    a.currency = s.currency ?? 'EUR'
    map.set(`${s.name}.md`, a)
    balances.set(`${s.name}.md`, s.balance)
  }
  return { map, balanceOf: (p: string) => balances.get(p) ?? 0 }
}

describe('currencyCard', () => {
  it('shows money owed to the owner even when the owner owes nothing', () => {
    const { map, balanceOf } = accounts([
      { name: 'Card', type: 'asset', balance: 1000 },
      { name: 'Lent to Bob', type: 'liability', balance: 300 },
    ])

    expect(currencyCard('EUR', map, balanceOf)).toEqual({
      currency: 'EUR',
      assets: 1000,
      debt: 0,
      owed: 300,
      net: 1300,
    })
  })

  it('keeps both directions apart when there are debts each way', () => {
    const { map, balanceOf } = accounts([
      { name: 'Card', type: 'asset', balance: 1000 },
      { name: 'Loan', type: 'liability', balance: -400 },
      { name: 'Lent to Bob', type: 'liability', balance: 300 },
    ])

    const card = currencyCard('EUR', map, balanceOf)
    expect(card.debt).toBe(400)
    expect(card.owed).toBe(300)
    expect(card.net).toBe(900)
  })

  it('ignores other currencies and accounts excluded from totals', () => {
    const { map, balanceOf } = accounts([
      { name: 'Card', type: 'asset', balance: 1000 },
      { name: 'Dollars', type: 'asset', currency: 'USD', balance: 50 },
      { name: 'Hidden', type: 'liability', balance: 70 },
    ])
    map.get('Hidden.md')!.excludeFromTotal = true

    expect(currencyCard('EUR', map, balanceOf)).toMatchObject({ assets: 1000, owed: 0, net: 1000 })
  })
})
