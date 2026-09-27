/**
 * The finance notes as tables: every transaction, the money moving through chosen accounts, or
 * balances over time. Read straight from the metadata cache, so it works whether or not a finance
 * screen was ever opened, and with the same rules the screens use — which account a link means
 * (resolved from the transaction's own note), what a wallet sees of a cross-currency transfer
 * (`walletAmount`, shared with `BalanceIndex`), what counts as income, spending or a transfer
 * (as the finance sidebar decides it).
 *
 * Money is carried in whole minor units (`money.ts`), so totals are exact.
 */
import type { App, TFile } from 'obsidian'
import { walletAmount } from '@/entities/walletAmount'
import { getNameFromPath } from '@/helpers/pathsHelpers'
import { scaleFor, toUnits } from '../money'
import { ImpliedRates, type RateObservation } from '../rates'
import { parseDate, parseNumber, type Column, type Row, type Table } from '../table'
import { readBalances } from './financeBalances'

export type FinanceMeasure = 'transactions' | 'flow' | 'balance'
export type TxKind = 'income' | 'expense' | 'transfer'

export interface FinanceSource {
  kind: 'finance'
  /** `transactions` (default), `flow` through `accounts`, or `balance` over time. */
  measure?: FinanceMeasure
  /** Dates, `YYYY-MM-DD`, both included. */
  from?: string
  to?: string
  /** Account names, paths or links. Transactions touching any; required for `flow`. */
  accounts?: string[]
  /** Category names, paths or links. */
  categories?: string[]
  /** Only income, only spending or only transfers. */
  only?: TxKind
  /** A note the transactions are linked to through `groups` — a trip, a project. */
  linkedTo?: string
  /** Convert every amount into this currency with the rates the vault's own transactions imply. */
  currency?: string
}

interface AccountInfo {
  path: string
  name: string
  type: string | null
  currency: string | null
  startingBalance: number
  startingDate: string | null
  excluded: boolean
  sources: string[]
}

export interface Tx {
  path: string
  date: string
  amount: number
  currency: string | null
  foreignAmount: number | null
  foreignCurrency: string | null
  from: string | null
  to: string | null
  category: string | null
  groups: string[]
}

export interface FinanceDeps {
  app: App
  inScope: (path: string) => boolean
  /** Today, `YYYY-MM-DD`: where a balance series ends when no `to` is given. */
  today: string
}

const linkText = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null
  const m = v.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/)
  return (m ? m[1] : v).trim()
}

export class Ledger {
  readonly accounts = new Map<string, AccountInfo>()
  readonly txs: Tx[] = []
  outOfScope = 0
  undated = 0
  private resolved = new Map<string, string | null>()

  constructor(private deps: FinanceDeps) {
    const { app } = deps
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter
      if (!fm) continue
      if (fm.type === 'account') this.addAccount(file, fm)
    }
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter
      if (fm?.type !== 'transaction') continue
      const date = parseDate(fm.date)
      const amount = parseNumber(fm.amount)
      if (!date || amount === null) {
        this.undated++
        continue
      }
      if (!deps.inScope(file.path)) {
        this.outOfScope++
        continue
      }
      this.txs.push({
        path: file.path,
        date,
        amount,
        currency: typeof fm.currency === 'string' && fm.currency ? fm.currency : null,
        foreignAmount: parseNumber(fm.foreignAmount),
        foreignCurrency:
          typeof fm.foreignCurrency === 'string' && fm.foreignCurrency ? fm.foreignCurrency : null,
        from: this.resolve(fm.from, file.path),
        to: this.resolve(fm.to, file.path),
        category: this.resolve(fm.category, file.path),
        groups: (Array.isArray(fm.groups) ? fm.groups : [])
          .map((g: unknown) => this.resolve(g, file.path))
          .filter((g: string | null): g is string => !!g),
      })
    }
    this.txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : 1))
  }

  private addAccount(file: TFile, fm: Record<string, unknown>): void {
    this.accounts.set(file.path, {
      path: file.path,
      name: file.basename,
      type: typeof fm.accountType === 'string' ? fm.accountType : null,
      currency: typeof fm.currency === 'string' && fm.currency ? fm.currency : null,
      startingBalance: parseNumber(fm.startingBalance) ?? 0,
      startingDate: parseDate(fm.startingBalanceDate),
      excluded: !!fm.excludeFromTotal,
      sources: Array.isArray(fm.accounts) ? fm.accounts.map(String) : [],
    })
  }

  /** A link as Obsidian would open it from `source`: to a path, or the text itself if it leads nowhere. */
  resolve(v: unknown, source: string): string | null {
    const text = linkText(v)
    if (!text) return null
    const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
    const key = `${folder}\u0000${text}`
    let path = this.resolved.get(key)
    if (path === undefined) {
      path = this.deps.app.metadataCache.getFirstLinkpathDest(text, source)?.path ?? null
      this.resolved.set(key, path)
    }
    return path ?? text
  }

  /** What someone typed for an account or a category, as a path; an error names the unknown one. */
  named(input: string, what: 'account' | 'category' | 'note'): string {
    const text = linkText(input) ?? input
    const direct = this.deps.app.vault.getAbstractFileByPath(text)
    if (direct && 'basename' in direct) return direct.path
    const found = this.deps.app.metadataCache.getFirstLinkpathDest(text, '')
    if (found) return found.path
    if (what === 'note') throw new Error(`No note called "${input}" was found.`)
    const byName = [...this.accounts.values()].find(
      (a) => a.name.toLowerCase() === text.toLowerCase()
    )
    if (byName) return byName.path
    throw new Error(`No ${what} called "${input}" was found.`)
  }

  typeOf(path: string | null): string | null {
    return path ? (this.accounts.get(path)?.type ?? null) : null
  }

  /** The currency a wallet holds, as `BalanceIndex.walletCurrency` has it. */
  walletCurrency(path: string | null): string | null {
    const a = path ? this.accounts.get(path) : undefined
    if (!a?.currency) return null
    return a.type === 'asset' || a.type === 'liability' ? a.currency : null
  }

  kindOf(tx: Tx): TxKind {
    if (this.typeOf(tx.to) === 'expense') return 'expense'
    if (this.typeOf(tx.from) === 'revenue') return 'income'
    return 'transfer'
  }

  /** A computed account (`accounts:` list) expanded into the accounts it adds up. */
  expand(path: string, seen = new Set<string>()): string[] {
    if (seen.has(path)) return []
    seen.add(path)
    const a = this.accounts.get(path)
    if (!a?.sources.length) return [path]
    return a.sources.flatMap((s) => {
      const p = this.resolve(s, path)
      return p && this.accounts.has(p) ? this.expand(p, seen) : []
    })
  }

  rates(): ImpliedRates {
    const obs: RateObservation[] = []
    for (const t of this.txs) {
      if (!t.currency || !t.foreignCurrency || !t.foreignAmount || !t.amount) continue
      obs.push({
        date: t.date,
        from: t.currency,
        to: t.foreignCurrency,
        rate: t.foreignAmount / t.amount,
      })
    }
    return new ImpliedRates(obs)
  }
}

export const name = (p: string | null) => (p ? getNameFromPath(p) : '')

/** Reads the finance notes into a table, as `spec` asks. */
export function readFinance(spec: FinanceSource, deps: FinanceDeps): Table {
  const ledger = new Ledger(deps)
  const measure = spec.measure ?? 'transactions'
  const accounts = (spec.accounts ?? []).map((a) => ledger.named(a, 'account'))
  const categories = new Set((spec.categories ?? []).map((c) => ledger.named(c, 'category')))
  const linked = spec.linkedTo ? ledger.named(spec.linkedTo, 'note') : null
  const target = spec.currency?.trim().toUpperCase() || null
  const rates = target ? ledger.rates() : null

  const meta: Record<string, unknown> = { source: 'finance', measure }
  if (ledger.outOfScope) meta.outOfScope = ledger.outOfScope
  if (ledger.undated) meta.skippedNoDateOrAmount = ledger.undated

  const inRange = (d: string) => (!spec.from || d >= spec.from) && (!spec.to || d <= spec.to)
  const matches = (t: Tx, forBalance = false): boolean => {
    if (!forBalance && !inRange(t.date)) return false
    if (categories.size && !(t.category && categories.has(t.category))) return false
    if (linked && !t.groups.includes(linked)) return false
    if (spec.only && ledger.kindOf(t) !== spec.only) return false
    return true
  }

  // Conversion: each amount into `target` on its own date. What cannot be converted is left out
  // of the table and counted, never added in as if it were the target currency.
  const unconverted = new Map<string, number>()
  const convert = (
    amount: number,
    currency: string | null,
    date: string,
    t?: Tx
  ): number | null => {
    if (!target) return amount
    if (!currency) {
      unconverted.set('(none)', (unconverted.get('(none)') ?? 0) + 1)
      return null
    }
    if (currency === target) return amount
    // The transaction's own second amount, when it is in the target currency, is exact.
    if (t && t.foreignCurrency === target && t.foreignAmount != null && t.currency === currency) {
      return Math.sign(amount) * Math.abs(t.foreignAmount) * (Math.abs(amount) / Math.abs(t.amount))
    }
    const r = rates.rate(currency, target, date)
    if (r === null) {
      unconverted.set(currency, (unconverted.get(currency) ?? 0) + 1)
      return null
    }
    return amount * r
  }
  const finishMeta = () => {
    if (target) {
      meta.currency = target
      meta.ratesUsed = [...rates.used.values()].map((u) => ({
        pair: `${u.from}→${u.to}`,
        rate: Number(u.rate.toPrecision(6)),
        asOf: u.date,
        ...(u.via ? { via: u.via } : {}),
      }))
      if (unconverted.size) {
        meta.unconverted = Object.fromEntries(unconverted)
        meta.warning =
          'Some amounts could not be converted: the vault has no two-currency transaction linking ' +
          'their currency to ' +
          target +
          '. They are left out of every number here.'
      }
    }
  }

  if (measure === 'transactions') {
    const accountSet = new Set(accounts.flatMap((a) => ledger.expand(a)))
    const raw: { t: Tx; amount: number; currency: string | null }[] = []
    for (const t of ledger.txs) {
      if (!matches(t)) continue
      if (
        accountSet.size &&
        !((t.from && accountSet.has(t.from)) || (t.to && accountSet.has(t.to)))
      )
        continue
      const amount = convert(t.amount, t.currency, t.date, t)
      if (amount === null) continue
      raw.push({ t, amount, currency: target ?? t.currency })
    }
    const scale = scaleFor(ledger.txs.map((t) => t.amount))
    const rows: Row[] = raw.map(({ t, amount, currency }) => ({
      date: t.date,
      amount: toUnits(amount, scale),
      currency: currency ?? '',
      kind: ledger.kindOf(t),
      from: name(t.from),
      to: name(t.to),
      category: name(t.category),
      groups: t.groups.map(name),
      path: t.path,
    }))
    finishMeta()
    return { columns: txColumns(scale, target), rows, meta }
  }

  if (measure === 'flow') {
    if (!accounts.length) {
      throw new Error(
        'A flow needs `accounts` — the accounts whose money in and out is counted. For all income ' +
          'or all spending use measure "transactions" with only: "income" or "expense".'
      )
    }
    const selected = new Set(accounts.flatMap((a) => ledger.expand(a)))
    const raw: {
      t: Tx
      account: string
      amount: number
      currency: string | null
      other: string | null
    }[] = []
    for (const t of ledger.txs) {
      if (!matches(t)) continue
      for (const role of ['from', 'to'] as const) {
        const acc = t[role]
        if (!acc || !selected.has(acc)) continue
        const other = role === 'from' ? t.to : t.from
        const signed = walletAmount(
          t,
          ledger.walletCurrency(acc),
          ledger.walletCurrency(other),
          role
        )
        const cur = ledger.walletCurrency(acc) ?? t.currency
        const amount = convert(signed, cur, t.date, cur === t.currency ? t : undefined)
        if (amount === null) continue
        raw.push({ t, account: acc, amount, currency: target ?? cur, other })
      }
    }
    const scale = scaleFor(ledger.txs.flatMap((t) => [t.amount, t.foreignAmount ?? 0]))
    const rows: Row[] = raw.map((r) => ({
      date: r.t.date,
      account: name(r.account),
      amount: toUnits(r.amount, scale),
      currency: r.currency ?? '',
      kind: ledger.kindOf(r.t),
      counterparty: name(r.other),
      category: name(r.t.category),
      path: r.t.path,
    }))
    finishMeta()
    const columns: Column[] = [
      { name: 'date', type: 'date' },
      { name: 'account', type: 'string' },
      { name: 'amount', type: 'money', scale, ...(target ? { currency: target } : {}) },
      { name: 'currency', type: 'string' },
      { name: 'kind', type: 'string' },
      { name: 'counterparty', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'path', type: 'string' },
    ]
    return { columns, rows, meta }
  }

  return readBalances(ledger, spec, accounts, deps, convert, finishMeta, meta)
}

function txColumns(scale: number, target: string | null): Column[] {
  return [
    { name: 'date', type: 'date' },
    { name: 'amount', type: 'money', scale, ...(target ? { currency: target } : {}) },
    { name: 'currency', type: 'string' },
    { name: 'kind', type: 'string' },
    { name: 'from', type: 'string' },
    { name: 'to', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'groups', type: 'list' },
    { name: 'path', type: 'string' },
  ]
}
