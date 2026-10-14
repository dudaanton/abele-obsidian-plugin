import { ref, watch, type Ref } from 'vue'
import { financeDirections } from '@/finance/accountTypes'
import type { Dayjs } from 'dayjs'
import type { AccountsList } from '@/entities/AccountsList'
import type { LedgerEntry } from './useFinanceLedger'
import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { addMoney } from '@/helpers/moneySum'
import { DATE_FORMAT } from '@/constants/dates'
import { AbeleConfig } from '@/services/AbeleConfig'
import { convert, type RateTable } from '@/finance/rates/convert'

/** The period tab that adds every currency up at today's rates. */
export const ALL_CURRENCIES = '*'

export interface PieItem {
  name: string
  value: number
  path?: string
}
interface CurrencyPeriodData {
  income: number
  expenses: number
  lent: number
  returned: number
  expenseBreakdown: PieItem[]
  incomeBreakdown: PieItem[]
  /** On the all-currencies tab: the currencies counted and those left out for want of a rate. */
  currencies?: string[]
  missing?: string[]
}
interface PeriodSummaryOptions {
  active: Ref<boolean>
  accountsList: Ref<AccountsList | null>
  ledger: Ref<LedgerEntry[]>
  pinnedCurrenciesList: Ref<string[]>
  periodStart: Ref<Dayjs>
  periodEnd: Ref<Dayjs>
  /** Today's rates, and the currency a sum of several is shown in. */
  rates?: () => { table: RateTable | null; display: string }
}

export function useFinancePeriodSummary(options: PeriodSummaryOptions) {
  const { active, accountsList, ledger, pinnedCurrenciesList, periodStart, periodEnd } = options
  const rates = options.rates ?? (() => ({ table: null, display: 'USD' }))
  const computed = <T>(getter: () => T) => pausedWhileHidden(active, getter)

  const periodByCurrency = computed(() => {
    const al = accountsList.value
    const result = new Map<string, CurrencyPeriodData>()
    if (!al) return result

    const startStr = periodStart.value.format(DATE_FORMAT)
    const endStr = periodEnd.value.format(DATE_FORMAT)

    const liabilityPaths = new Set<string>()
    const accountNames = new Map<string, string>()
    for (const [path, account] of al.accounts) {
      if (account.accountType === 'liability') liabilityPaths.add(path)
      accountNames.set(path, account.accountName || account.title || path.split('/').pop() || path)
    }

    // key: "currency|accountPath"
    const expenseMap = new Map<string, number>()
    const incomeMap = new Map<string, number>()
    const add = (map: Map<string, number>, key: string, value: number) =>
      map.set(key, addMoney(map.get(key) || 0, value))
    const { table, display } = rates()
    const counted = new Set<string>()
    const missing = new Set<string>()

    const getOrCreate = (cur: string): CurrencyPeriodData => {
      if (!result.has(cur)) {
        result.set(cur, {
          income: 0,
          expenses: 0,
          lent: 0,
          returned: 0,
          expenseBreakdown: [],
          incomeBreakdown: [],
        })
      }
      return result.get(cur)!
    }

    for (const entry of ledger.value) {
      if (entry.amount == null || !entry.currency) continue
      if (entry.date < startStr || entry.date > endStr) continue

      const cur = entry.currency
      const { from: fromPath, to: toPath, amount } = entry
      const { income, expense } = financeDirections(
        fromPath ? al.accounts.get(fromPath)?.accountType : null,
        toPath ? al.accounts.get(toPath)?.accountType : null
      )
      // The same money once more, at today's rate, into the tab of all currencies.
      if (table) {
        const usd = convert(amount, cur, display, table)
        if (usd === null) missing.add(cur.toUpperCase())
        else {
          counted.add(cur.toUpperCase())
          const value = Math.round(usd * 100) / 100
          if (toPath && expense) add(expenseMap, `${ALL_CURRENCIES}|${toPath}`, value)
          if (toPath && liabilityPaths.has(toPath))
            getOrCreate(ALL_CURRENCIES).lent = addMoney(getOrCreate(ALL_CURRENCIES).lent, value)
          if (fromPath && income) add(incomeMap, `${ALL_CURRENCIES}|${fromPath}`, value)
          if (fromPath && liabilityPaths.has(fromPath))
            getOrCreate(ALL_CURRENCIES).returned = addMoney(
              getOrCreate(ALL_CURRENCIES).returned,
              value
            )
        }
      }

      if (toPath && expense) {
        const key = `${cur}|${toPath}`
        expenseMap.set(key, addMoney(expenseMap.get(key) || 0, amount))
      }
      if (toPath && liabilityPaths.has(toPath)) {
        getOrCreate(cur).lent = addMoney(getOrCreate(cur).lent, amount)
      }

      if (fromPath && income) {
        const key = `${cur}|${fromPath}`
        incomeMap.set(key, addMoney(incomeMap.get(key) || 0, amount))
      }
      if (fromPath && liabilityPaths.has(fromPath)) {
        getOrCreate(cur).returned = addMoney(getOrCreate(cur).returned, amount)
      }
    }

    for (const [key, total] of expenseMap) {
      const [cur, path] = key.split('|')
      const data = getOrCreate(cur)
      data.expenses = addMoney(data.expenses, total)
      if (total > 0) {
        data.expenseBreakdown.push({
          name: accountNames.get(path) || path,
          value: Math.round(total * 100) / 100,
          path,
        })
      }
    }

    for (const [key, total] of incomeMap) {
      const [cur, path] = key.split('|')
      const data = getOrCreate(cur)
      data.income = addMoney(data.income, total)
      if (total > 0) {
        data.incomeBreakdown.push({
          name: accountNames.get(path) || path,
          value: Math.round(total * 100) / 100,
          path,
        })
      }
    }

    for (const data of result.values()) {
      data.expenseBreakdown.sort((a, b) => b.value - a.value)
      data.incomeBreakdown.sort((a, b) => b.value - a.value)
    }

    // Adding up is worth a tab only where there is more than one currency to add.
    const all = result.get(ALL_CURRENCIES)
    if (all && result.size > 2) {
      all.currencies = [...counted].sort()
      all.missing = [...missing].sort()
    } else result.delete(ALL_CURRENCIES)

    return result
  })

  const periodCurrencies = computed(() => {
    const pinned = pinnedCurrenciesList.value
    const all = Array.from(periodByCurrency.value.keys()).filter((c) => c !== ALL_CURRENCIES)
    // Pinned first, then the rest
    const ordered = pinned.filter((c) => all.includes(c))
    for (const c of all) {
      if (!ordered.includes(c)) ordered.push(c)
    }
    return periodByCurrency.value.has(ALL_CURRENCIES) ? [ALL_CURRENCIES, ...ordered] : ordered
  })

  const selectedPeriodCurrency = ref(
    AbeleConfig.getInstance().pinnedCurrencies.split(',')[0]?.trim().toUpperCase() || 'EUR'
  )

  // The tab of all currencies is named by the one they are shown in, with the sign of approximate.
  const currencyTabs = computed(() =>
    periodCurrencies.value.map((c) =>
      c === ALL_CURRENCIES
        ? {
            id: c,
            label: `≈ ${rates().display}`,
            tooltip: `Every currency in ${rates().display}, at today's rates`,
          }
        : { id: c, label: c }
    )
  )

  // Auto-select first available currency if current selection has no data
  watch(periodCurrencies, (currencies) => {
    if (
      currencies.length &&
      !currencies.includes(selectedPeriodCurrency.value) &&
      !pinnedCurrenciesList.value.includes(selectedPeriodCurrency.value)
    ) {
      selectedPeriodCurrency.value = currencies[0]
    }
  })

  const emptyPeriodData: CurrencyPeriodData = {
    income: 0,
    expenses: 0,
    lent: 0,
    returned: 0,
    expenseBreakdown: [],
    incomeBreakdown: [],
  }

  const periodTotals = computed((): CurrencyPeriodData => {
    return periodByCurrency.value.get(selectedPeriodCurrency.value) || emptyPeriodData
  })

  const periodIncome = computed(() => periodTotals.value.income)
  const periodExpenses = computed(() => periodTotals.value.expenses)
  const periodLent = computed(() => periodTotals.value.lent)
  const periodReturned = computed(() => periodTotals.value.returned)
  const periodSavings = computed(() => addMoney(periodIncome.value, -periodExpenses.value))

  return {
    periodCurrencies,
    selectedPeriodCurrency,
    currencyTabs,
    periodTotals,
    periodIncome,
    periodExpenses,
    periodLent,
    periodReturned,
    periodSavings,
  }
}
