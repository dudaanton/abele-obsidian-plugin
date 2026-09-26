/**
 * A property linking to a wallet — an account note that holds money, an asset or a liability —
 * shows what is in that wallet today, beside the link. A transaction's `from` and `to` are the
 * usual ones, but any property linking to a wallet does it, whatever it is called.
 *
 * Expense and revenue accounts are categories, not wallets: their "balance" is a total spent or
 * earned, and nobody reads it off a transaction's `to`.
 */
import dayjs from 'dayjs'
import type { AccountType } from '@/entities/Account'
import { formatAmount } from '@/helpers/moneyFormat'
import { isWikilink, linkTarget } from './values'

export interface WalletAccount {
  accountType: AccountType | null
  currency: string | null
}

/** What the badge needs from the plugin's finance: the account at a path, its balance today. */
export interface WalletSource {
  resolve(linkpath: string, sourcePath: string): string | null
  account(path: string): WalletAccount | null
  balance(path: string, date: dayjs.Dayjs): number
}

export interface WalletBalance {
  path: string
  text: string
  negative: boolean
}

export function holdsBalance(type: AccountType | null): boolean {
  return type === 'asset' || type === 'liability'
}

/** The wallet a value links to and what is in it today — or null when it is not a wallet. */
export function walletBalance(
  value: unknown,
  sourcePath: string,
  source: WalletSource,
  today = dayjs()
): WalletBalance | null {
  if (!isWikilink(value)) return null
  const target = linkTarget(value)
  const path = target ? source.resolve(target, sourcePath) : null
  const account = path ? source.account(path) : null
  if (!path || !account || !holdsBalance(account.accountType)) return null
  const amount = source.balance(path, today)
  const text = formatAmount(amount)
  return {
    path,
    text: account.currency ? `${text} ${account.currency}` : text,
    negative: Number(amount.toFixed(2)) < 0,
  }
}
