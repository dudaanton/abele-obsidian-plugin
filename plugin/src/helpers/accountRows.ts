import { addMoney } from '@/helpers/moneySum'
import { isCategoryType } from '@/finance/accountTypes'
import type { Account, AccountType } from '@/entities/Account'
import { convert, sumConverted, type RateTable } from '@/finance/rates/convert'

export type AccountsSort = 'size' | 'balance' | 'name'

/** What the accounts panel shows. Kept in settings, so it travels with them. */
export interface AccountsListSettings {
  /** `size` is the balance's magnitude, so a large debt ranks beside a large deposit. */
  sort: AccountsSort
  groupByType: boolean
  /** Types listed, in no particular order. */
  types: AccountType[]
  hideZero: boolean
  /** Accounts marked `excludeFromTotal`. Listed, but never counted in a total. */
  showExcluded: boolean
  /** One currency only, or every currency when empty. */
  currency: string
}

export const DEFAULT_ACCOUNTS_LIST: AccountsListSettings = {
  sort: 'size',
  groupByType: true,
  types: ['asset', 'liability', 'computed'],
  hideZero: true,
  showExcluded: true,
  currency: '',
}

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'asset',
  'liability',
  'computed',
  'expense',
  'revenue',
  'mixed',
]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Debts',
  computed: 'Computed',
  expense: 'Expenses',
  revenue: 'Income',
  mixed: 'Mixed',
}

/** Fills in whatever a stored copy lacks, and drops anything it should not hold. */
export function normalizeAccountsList(stored: unknown): AccountsListSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<AccountsListSettings>
  const d = DEFAULT_ACCOUNTS_LIST
  return {
    sort: s.sort === 'size' || s.sort === 'balance' || s.sort === 'name' ? s.sort : d.sort,
    groupByType: typeof s.groupByType === 'boolean' ? s.groupByType : d.groupByType,
    types: Array.isArray(s.types)
      ? ACCOUNT_TYPE_ORDER.filter((t) => s.types.includes(t))
      : [...d.types],
    hideZero: typeof s.hideZero === 'boolean' ? s.hideZero : d.hideZero,
    showExcluded: typeof s.showExcluded === 'boolean' ? s.showExcluded : d.showExcluded,
    currency: typeof s.currency === 'string' ? s.currency.trim().toUpperCase() : d.currency,
  }
}

export interface AccountRow {
  path: string
  name: string
  type: AccountType
  currency: string
  balance: number
  excluded: boolean
}

/** The balances the rows are read from — the balance index, or a stand-in in a test. */
export interface BalanceSource {
  /** An asset or liability account's balance, in its own currency. */
  balance(path: string): number
  /** The currencies a category account has moved money in. */
  currencies(path: string): string[]
  balanceIn(path: string, currency: string): number
  /** A link from a computed account's note to one of the accounts it adds up. */
  resolve(wikilink: string): string | null
}

/** Balances rounded to the cent, so a sum that lands on 0.0000001 still reads as empty. */
const cents = (n: number): number => Math.round(n * 100) / 100

/**
 * One row per account and currency. An expense, revenue or mixed account has no currency of its
 * own, so it gets a row for each currency it has seen — what it totals, all time.
 */
export function accountRows(
  accounts: Iterable<[string, Account]>,
  source: BalanceSource,
  settings: AccountsListSettings,
  /** Today's rates: amounts of different currencies are then ordered by what they are worth. */
  table: RateTable | null = null
): AccountRow[] {
  const rows: AccountRow[] = []
  const all = new Map(accounts)

  for (const [path, account] of all) {
    const type = account.accountType
    if (!type || !settings.types.includes(type)) continue
    if (account.excludeFromTotal && !settings.showExcluded) continue

    const base = {
      path,
      name: account.accountName || account.title || path,
      type,
      excluded: account.excludeFromTotal,
    }

    if (isCategoryType(type)) {
      for (const currency of source.currencies(path)) {
        // Money leaving an expense account is a refund; the natural reading is what was
        // spent or earned, which is the other way round for revenue. Mixed shows signed
        // net category flow (in minus out), not a wallet balance.
        const raw = source.balanceIn(path, currency)
        rows.push({ ...base, currency, balance: cents(type === 'revenue' ? -raw : raw) })
      }
      continue
    }

    if (type === 'computed') {
      const parts: Array<{ amount: number; currency: string }> = []
      for (const wikilink of account.sourceAccounts) {
        const sourcePath = source.resolve(wikilink)
        if (sourcePath)
          parts.push({
            amount: source.balance(sourcePath),
            currency: all.get(sourcePath)?.currency ?? '',
          })
      }
      const sum = computedSum(parts, account.currency ?? '', table)
      rows.push({ ...base, currency: sum.currency, balance: cents(sum.amount) })
      continue
    }
    rows.push({ ...base, currency: account.currency || '', balance: cents(source.balance(path)) })
  }

  return rows
    .filter((row) => !settings.currency || row.currency === settings.currency)
    .filter((row) => !settings.hideZero || row.balance !== 0)
    .sort(compareBy(settings.sort, table))
}

/**
 * A computed account's balance from its sources: those in its own currency (or with none) are
 * added as they are, the rest converted at today's rates, and a source no rate covers is left out
 * and named rather than counted as if it were the same money. With no currency of its own it
 * takes the one its sources share.
 */
export function computedSum(
  parts: Array<{ amount: number; currency: string }>,
  own: string,
  table: RateTable | null
): { amount: number; currency: string; converted: boolean; missing: string[] } {
  const codes = [...new Set(parts.map((p) => p.currency.trim().toUpperCase()).filter(Boolean))]
  const currency = own.trim().toUpperCase() || (codes.length === 1 ? codes[0] : '')
  let amount = 0
  let converted = false
  const missing = new Set<string>()
  for (const part of parts) {
    const code = part.currency.trim().toUpperCase()
    if (!code || code === currency || !currency) {
      amount = addMoney(amount, part.amount)
      continue
    }
    const value = convert(part.amount, code, currency, table)
    if (value === null) missing.add(code)
    else {
      amount = addMoney(amount, cents(value))
      converted = true
    }
  }
  return { amount, currency, converted, missing: [...missing].sort() }
}

/**
 * By size or balance, rows of different currencies compare by what they are worth in dollars at
 * today's rates; one with no rate goes after all those with one, among its own by its own amount.
 * Without a table every row compares by its own number, as before.
 */
function compareBy(
  sort: AccountsSort,
  table: RateTable | null
): (a: AccountRow, b: AccountRow) => number {
  const byName = (a: AccountRow, b: AccountRow) =>
    a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency)
  if (sort === 'name') return byName
  const worth = (row: AccountRow) =>
    table ? convert(row.balance, row.currency, 'USD', table) : row.balance
  const key = (row: AccountRow, value: number) => (sort === 'size' ? Math.abs(value) : value)
  return (a, b) => {
    const wa = worth(a)
    const wb = worth(b)
    if ((wa === null) !== (wb === null)) return wa === null ? 1 : -1
    const va = wa ?? a.balance
    const vb = wb ?? b.balance
    return key(b, vb) - key(a, va) || byName(a, b)
  }
}

export interface AccountGroup {
  /** Null when the list is not grouped. */
  type: AccountType | null
  label: string
  rows: AccountRow[]
  /** Per currency, leaving out accounts excluded from totals. */
  totals: Array<{ currency: string; amount: number }>
  /** The totals of two currencies or more as one, at today's rates. */
  converted?: { amount: number; currency: string; currencies: string[]; missing: string[] }
}

export function groupAccountRows(
  rows: AccountRow[],
  byType: boolean,
  rates?: { table: RateTable | null; display: string }
): AccountGroup[] {
  const groups: AccountGroup[] = byType
    ? ACCOUNT_TYPE_ORDER.map((type) => ({
        type,
        label: ACCOUNT_TYPE_LABELS[type],
        rows: rows.filter((row) => row.type === type),
        totals: [] as AccountGroup['totals'],
      }))
    : [{ type: null, label: '', rows, totals: [] as AccountGroup['totals'] }]

  for (const group of groups) {
    const sums = new Map<string, number>()
    for (const row of group.rows) {
      if (row.excluded) continue
      sums.set(row.currency, addMoney(sums.get(row.currency) ?? 0, row.balance))
    }
    group.totals = [...sums]
      .map(([currency, amount]) => ({ currency, amount: cents(amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
    if (rates?.table && group.totals.length > 1) {
      const sum = sumConverted(group.totals, rates.display, rates.table)
      group.converted = {
        amount: cents(sum.total),
        currency: rates.display,
        currencies: sum.currencies,
        missing: sum.missing,
      }
    }
  }

  return groups.filter((group) => group.rows.length > 0)
}
