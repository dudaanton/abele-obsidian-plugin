/**
 * What the transaction dialog says about the accounts on either side: which accounts to offer
 * as a name is typed, and what the transaction does to a wallet's balance.
 */
import type { Account, AccountType } from '@/entities/Account'
import { pathToWikilink } from '@/helpers/pathsHelpers'
import type { TransactionFormValues } from '@/helpers/entryForms'

export interface WalletOption {
  path: string
  /** What goes into `from` / `to`, the way the plugin links accounts everywhere else. */
  link: string
  name: string
  type: AccountType | null
  currency: string | null
}

/**
 * Money leaves from a wallet or an income and goes to a wallet or a spending account, so each
 * side offers the likelier kind first. Within a kind, by name.
 */
const ORDER: Record<'from' | 'to', AccountType[]> = {
  from: ['asset', 'liability', 'revenue', 'computed', 'expense'],
  to: ['expense', 'asset', 'liability', 'computed', 'revenue'],
}

const nameOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/, '')

/** The accounts whose name holds the query, the likelier kind for that side first. */
export function walletOptions(
  accounts: Map<string, Account>,
  query: string,
  side: 'from' | 'to',
  limit = 50
): WalletOption[] {
  const q = query.trim().toLowerCase()
  const rank = (type: AccountType | null) => {
    const at = type ? ORDER[side].indexOf(type) : -1
    return at === -1 ? ORDER[side].length : at
  }
  return [...accounts.entries()]
    .filter(([, account]) => account.accountType !== 'computed')
    .map(([path, account]) => ({
      path,
      link: pathToWikilink(path),
      name: nameOf(path),
      type: account.accountType,
      currency: account.currency,
    }))
    .filter((option) => !q || option.name.toLowerCase().includes(q))
    .sort((a, b) => {
      // A name that starts with what was typed beats one that only contains it.
      if (q) {
        const aStart = a.name.toLowerCase().startsWith(q)
        const bStart = b.name.toLowerCase().startsWith(q)
        if (aStart !== bStart) return aStart ? -1 : 1
      }
      return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

/** Whether an account holds a balance worth showing: a wallet or a debt, not a spending pot. */
export function holdsBalance(type: AccountType | null): boolean {
  return type === 'asset' || type === 'liability'
}

/**
 * What this transaction adds to the balance of the wallet on `side`, in that wallet's own
 * currency: the amount leaves `from` and arrives at `to`, and a wallet in the second currency
 * of a two-currency transaction moves by the second amount. The same reading as the balance
 * index, for the simple case a new transaction is.
 */
export function walletEffect(
  side: 'from' | 'to',
  values: Pick<TransactionFormValues, 'amount' | 'foreignAmount' | 'foreignCurrency'>,
  walletCurrency: string | null
): number | null {
  const inForeign =
    !!walletCurrency && !!values.foreignCurrency && walletCurrency === values.foreignCurrency
  const amount = inForeign ? values.foreignAmount : values.amount
  if (amount == null) return null
  return side === 'from' ? -amount : amount
}
