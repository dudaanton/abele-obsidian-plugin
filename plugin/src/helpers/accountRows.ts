import type { Account, AccountType } from '@/entities/Account'

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
]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Debts',
  computed: 'Computed',
  expense: 'Expenses',
  revenue: 'Income',
}

/** Fills in whatever a stored copy lacks, and drops anything it should not hold. */
export function normalizeAccountsList(stored: unknown): AccountsListSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<AccountsListSettings>
  const d = DEFAULT_ACCOUNTS_LIST
  return {
    sort: s.sort === 'size' || s.sort === 'balance' || s.sort === 'name' ? s.sort : d.sort,
    groupByType: typeof s.groupByType === 'boolean' ? s.groupByType : d.groupByType,
    types: Array.isArray(s.types)
      ? ACCOUNT_TYPE_ORDER.filter((t) => s.types!.includes(t))
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
  /** The currencies an expense or revenue account has moved money in. */
  currencies(path: string): string[]
  balanceIn(path: string, currency: string): number
  /** A link from a computed account's note to one of the accounts it adds up. */
  resolve(wikilink: string): string | null
}

/** Balances rounded to the cent, so a sum that lands on 0.0000001 still reads as empty. */
const cents = (n: number): number => Math.round(n * 100) / 100

/**
 * One row per account and currency. An expense or revenue account has no currency of its
 * own, so it gets a row for each currency it has seen — what it totals, all time.
 */
export function accountRows(
  accounts: Iterable<[string, Account]>,
  source: BalanceSource,
  settings: AccountsListSettings
): AccountRow[] {
  const rows: AccountRow[] = []

  for (const [path, account] of accounts) {
    const type = account.accountType
    if (!type || !settings.types.includes(type)) continue
    if (account.excludeFromTotal && !settings.showExcluded) continue

    const base = {
      path,
      name: account.accountName || account.title || path,
      type,
      excluded: account.excludeFromTotal,
    }

    if (type === 'expense' || type === 'revenue') {
      for (const currency of source.currencies(path)) {
        // Money leaving an expense account is a refund; the natural reading is what was
        // spent or earned, which is the other way round for revenue.
        const raw = source.balanceIn(path, currency)
        rows.push({ ...base, currency, balance: cents(type === 'revenue' ? -raw : raw) })
      }
      continue
    }

    let balance = 0
    if (type === 'computed') {
      for (const wikilink of account.sourceAccounts) {
        const sourcePath = source.resolve(wikilink)
        if (sourcePath) balance += source.balance(sourcePath)
      }
    } else {
      balance = source.balance(path)
    }
    rows.push({ ...base, currency: account.currency || '', balance: cents(balance) })
  }

  return rows
    .filter((row) => !settings.currency || row.currency === settings.currency)
    .filter((row) => !settings.hideZero || row.balance !== 0)
    .sort(compareBy(settings.sort))
}

function compareBy(sort: AccountsSort): (a: AccountRow, b: AccountRow) => number {
  const byName = (a: AccountRow, b: AccountRow) =>
    a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency)
  if (sort === 'name') return byName
  if (sort === 'balance') return (a, b) => b.balance - a.balance || byName(a, b)
  return (a, b) => Math.abs(b.balance) - Math.abs(a.balance) || byName(a, b)
}

export interface AccountGroup {
  /** Null when the list is not grouped. */
  type: AccountType | null
  label: string
  rows: AccountRow[]
  /** Per currency, leaving out accounts excluded from totals. */
  totals: Array<{ currency: string; amount: number }>
}

export function groupAccountRows(rows: AccountRow[], byType: boolean): AccountGroup[] {
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
      sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.balance)
    }
    group.totals = [...sums]
      .map(([currency, amount]) => ({ currency, amount: cents(amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  }

  return groups.filter((group) => group.rows.length > 0)
}
