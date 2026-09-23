import type { Account } from '@/entities/Account'

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
      assets += balanceOf(path)
    } else if (account.accountType === 'liability') {
      const balance = balanceOf(path)
      if (balance < 0) debt += -balance
      else owed += balance
    }
  }

  return { currency, assets, debt, owed, net: assets - debt + owed }
}
