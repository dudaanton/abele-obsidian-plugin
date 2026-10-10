import { ref, watch, type Ref } from 'vue'
import type { Dayjs } from 'dayjs'
import type { AccountsList } from '@/entities/AccountsList'
import type { LedgerEntry } from './useFinanceLedger'
import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { addMoney } from '@/helpers/moneySum'
import { DATE_FORMAT } from '@/constants/dates'
import { AbeleConfig } from '@/services/AbeleConfig'

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
}
interface PeriodSummaryOptions {
  active: Ref<boolean>
  accountsList: Ref<AccountsList | null>
  ledger: Ref<LedgerEntry[]>
  pinnedCurrenciesList: Ref<string[]>
  periodStart: Ref<Dayjs>
  periodEnd: Ref<Dayjs>
}

export function useFinancePeriodSummary(options: PeriodSummaryOptions) {
  const { active, accountsList, ledger, pinnedCurrenciesList, periodStart, periodEnd } = options
  const computed = <T>(getter: () => T) => pausedWhileHidden(active, getter)

  const periodByCurrency = computed(() => {
    const al = accountsList.value
    const result = new Map<string, CurrencyPeriodData>()
    if (!al) return result

    const startStr = periodStart.value.format(DATE_FORMAT)
    const endStr = periodEnd.value.format(DATE_FORMAT)

    const expensePaths = new Set<string>()
    const revenuePaths = new Set<string>()
    const liabilityPaths = new Set<string>()
    const accountNames = new Map<string, string>()
    for (const [path, account] of al.accounts) {
      if (account.accountType === 'expense') expensePaths.add(path)
      if (account.accountType === 'revenue') revenuePaths.add(path)
      if (account.accountType === 'liability') liabilityPaths.add(path)
      accountNames.set(path, account.accountName || account.title || path.split('/').pop() || path)
    }

    // key: "currency|accountPath"
    const expenseMap = new Map<string, number>()
    const incomeMap = new Map<string, number>()

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

      if (toPath && expensePaths.has(toPath)) {
        const key = `${cur}|${toPath}`
        expenseMap.set(key, addMoney(expenseMap.get(key) || 0, amount))
      }
      if (toPath && liabilityPaths.has(toPath)) {
        getOrCreate(cur).lent = addMoney(getOrCreate(cur).lent, amount)
      }

      if (fromPath && revenuePaths.has(fromPath)) {
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

    return result
  })

  const periodCurrencies = computed(() => {
    const pinned = pinnedCurrenciesList.value
    const all = Array.from(periodByCurrency.value.keys())
    // Pinned first, then the rest
    const ordered = pinned.filter((c) => all.includes(c))
    for (const c of all) {
      if (!ordered.includes(c)) ordered.push(c)
    }
    return ordered
  })

  const selectedPeriodCurrency = ref(
    AbeleConfig.getInstance().pinnedCurrencies.split(',')[0]?.trim().toUpperCase() || 'EUR'
  )

  const currencyTabs = computed(() => periodCurrencies.value.map((c) => ({ id: c, label: c })))

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
