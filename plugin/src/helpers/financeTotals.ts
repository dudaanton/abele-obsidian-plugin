import { addMoney } from '@/helpers/moneySum'
import type { Account } from '@/entities/Account'
import { sumConverted, type RateTable } from '@/finance/rates/convert'

/**
 * What the finance sidebar shows for one currency: money held, what is owed in both
 * directions, and the net of all three.
 *
 * A liability account's balance carries the direction: negative means the owner owes it
 * (a loan taken), positive means it owes the owner (money lent). Both are debts and each is
 * shown on its own, so a sidebar where only other people owe money still says so.
 */
export interface CurrencyCard {
  currency: string
  assets: number
  /** What the owner owes, as a positive number. */
  debt: number
  /** What others owe the owner. */
  owed: number
  net: number
}

export function currencyCard(
  currency: string,
  accounts: Iterable<[string, Account]>,
  balanceOf: (path: string) => number
): CurrencyCard {
  let assets = 0
  let debt = 0
  let owed = 0

  for (const [path, account] of accounts) {
    if (account.currency !== currency) continue
    if (account.excludeFromTotal) continue

    if (account.accountType === 'asset') {
      assets = addMoney(assets, balanceOf(path))
    } else if (account.accountType === 'liability') {
      const balance = balanceOf(path)
      if (balance < 0) debt = addMoney(debt, -balance)
      else owed = addMoney(owed, balance)
    }
  }

  return { currency, assets, debt, owed, net: addMoney(addMoney(assets, -debt), owed) }
}

/** The cards of every currency held, as one in `display` at today's rates. */
export interface ConvertedCard extends CurrencyCard {
  /** Currencies counted, for their rates in the tooltip. */
  currencies: string[]
  /** Currencies left out for want of a rate. */
  missing: string[]
}

export function convertedCard(
  cards: CurrencyCard[],
  display: string,
  table: RateTable | null
): ConvertedCard {
  const sum = (field: 'assets' | 'debt' | 'owed' | 'net') =>
    sumConverted(
      cards.map((c) => ({ amount: c[field], currency: c.currency })),
      display,
      table
    )
  const assets = sum('assets')
  return {
    currency: display,
    assets: assets.total,
    debt: sum('debt').total,
    owed: sum('owed').total,
    net: sum('net').total,
    currencies: assets.currencies,
    missing: assets.missing,
  }
}
