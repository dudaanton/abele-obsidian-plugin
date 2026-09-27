import { walletAmount } from '@/entities/walletAmount'
import { scaleFor, toUnits } from '../money'
import type { Column, Row, Table } from '../table'
import { name, type FinanceDeps, type FinanceSource, type Ledger } from './finance'

/**
 * Balances over time: one row per day a balance changed, plus the first day of the range and its
 * last, so a series resampled with `last` and filled with `previous` reads as the balance at the
 * end of every period. An account has no balance before its `startingBalanceDate` (no row), and
 * from then on the starting balance plus every transaction dated on or after it — `BalanceIndex`'s
 * rule. With no `accounts`, net worth: every asset and liability not excluded from totals, one
 * series per currency (or one, converted).
 */
export function readBalances(
  ledger: Ledger,
  spec: FinanceSource,
  accountInputs: string[],
  deps: FinanceDeps,
  convert: (amount: number, currency: string | null, date: string) => number | null,
  finishMeta: () => void,
  meta: Record<string, unknown>
): Table {
  const isWallet = (p: string) => {
    const t = ledger.typeOf(p)
    return t === 'asset' || t === 'liability'
  }
  for (const p of accountInputs) {
    const t = ledger.typeOf(p)
    if (t && t !== 'asset' && t !== 'liability' && t !== 'computed') {
      throw new Error(
        `${name(p)} is a${t === 'expense' ? 'n' : ''} ${t} account, which has no balance — ` +
          'ask for measure "flow" (or "transactions") on it instead.'
      )
    }
    if (!deps.inScope(p)) throw new Error(`${p} is outside this chat's scope.`)
  }

  // Each series: a name, the wallets it adds up, and the currency they are in.
  const series: { label: string; wallets: string[] }[] = accountInputs.length
    ? accountInputs.map((p) => ({ label: name(p), wallets: ledger.expand(p).filter(isWallet) }))
    : [
        {
          label: 'Net worth',
          wallets: [...ledger.accounts.values()]
            .filter((a) => isWallet(a.path) && !a.excluded)
            .map((a) => a.path),
        },
      ]

  // Every change to every wallet, in units at one scale.
  const scale = scaleFor([
    ...ledger.txs.flatMap((t) => [t.amount, t.foreignAmount ?? 0]),
    ...[...ledger.accounts.values()].map((a) => a.startingBalance),
  ])
  const deltas = new Map<string, Map<string, number>>() // wallet → date → units
  const add = (wallet: string, date: string, units: number) => {
    let m = deltas.get(wallet)
    if (!m) deltas.set(wallet, (m = new Map()))
    m.set(date, (m.get(date) ?? 0) + units)
  }
  for (const a of ledger.accounts.values()) {
    if (!isWallet(a.path)) continue
    add(a.path, a.startingDate ?? '0000-01-01', toUnits(a.startingBalance, scale))
  }
  for (const t of ledger.txs) {
    for (const role of ['from', 'to'] as const) {
      const w = t[role]
      if (!w || !isWallet(w)) continue
      const start = ledger.accounts.get(w)?.startingDate
      if (start && t.date < start) continue
      const other = role === 'from' ? t.to : t.from
      const signed = walletAmount(t, ledger.walletCurrency(w), ledger.walletCurrency(other), role)
      add(w, t.date, toUnits(signed, scale))
    }
  }

  const end = spec.to ?? deps.today
  const rows: Row[] = []
  for (const s of series) {
    // Units per currency, cumulative, at each date something changed.
    const byCurrency = new Map<string, Map<string, number>>()
    let firstDate: string | null = null
    for (const w of s.wallets) {
      const cur = ledger.walletCurrency(w) ?? ''
      let m = byCurrency.get(cur)
      if (!m) byCurrency.set(cur, (m = new Map()))
      for (const [date, u] of deltas.get(w) ?? []) {
        m.set(date, (m.get(date) ?? 0) + u)
        const real = date === '0000-01-01' ? null : date
        if (real && (!firstDate || real < firstDate)) firstDate = real
      }
    }
    const starts = s.wallets.map((w) => ledger.accounts.get(w)?.startingDate).filter(Boolean)
    const seriesStart =
      starts.length === s.wallets.length && starts.length ? starts.sort()[0] : null
    const from = [spec.from, seriesStart].filter(Boolean).sort().pop() ?? firstDate ?? end

    const allDates = new Set<string>([from, end])
    for (const m of byCurrency.values())
      for (const d of m.keys()) if (d > from && d <= end) allDates.add(d)
    const dates = [...allDates].filter((d) => d >= from && d <= end).sort()

    const running = new Map<string, number>()
    const sortedDeltas = new Map(
      [...byCurrency].map(([cur, m]) => [cur, [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1))])
    )
    const cursor = new Map<string, number>()
    for (const d of dates) {
      for (const [cur, list] of sortedDeltas) {
        let i = cursor.get(cur) ?? 0
        let total = running.get(cur) ?? 0
        while (i < list.length && list[i][0] <= d) total += list[i++][1]
        cursor.set(cur, i)
        running.set(cur, total)
      }
      if (spec.currency) {
        let sum = 0
        let ok = true
        for (const [cur, units] of running) {
          const v = convert(units / 10 ** scale, cur || null, d)
          if (v === null) ok = false
          else sum += v
        }
        if (ok)
          rows.push({
            date: d,
            account: s.label,
            balance: toUnits(sum, scale),
            currency: (meta.currency as string) ?? spec.currency.toUpperCase(),
          })
      } else {
        for (const [cur, units] of running) {
          rows.push({ date: d, account: s.label, balance: units, currency: cur })
        }
      }
    }
  }
  finishMeta()
  if (spec.currency) meta.currency = spec.currency.toUpperCase()
  const columns: Column[] = [
    { name: 'date', type: 'date' },
    { name: 'account', type: 'string' },
    {
      name: 'balance',
      type: 'money',
      level: true,
      scale,
      ...(spec.currency ? { currency: spec.currency.toUpperCase() } : {}),
    },
    { name: 'currency', type: 'string' },
  ]
  return { columns, rows, meta }
}
