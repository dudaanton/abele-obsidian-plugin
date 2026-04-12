import { DATE_FORMAT } from '@/constants/dates'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { debounce, EventRef, normalizePath, TFile } from 'obsidian'
import { toRaw } from 'vue'
import { AccountsList } from './AccountsList'
import { Transaction } from './Transaction'
import { TransactionsList } from './TransactionsList'

interface BalanceEntry {
  date: string // YYYY-MM-DD
  amount: number // signed: positive = inflow, negative = outflow
  transactionPath: string
}

export class BalanceIndex {
  private transactionsList: TransactionsList
  private accountsList: AccountsList

  private accountEntries: Map<string, BalanceEntry[]> = new Map()
  private prefixSums: Map<string, number[]> = new Map()

  // Cache resolved wikilink → path to avoid repeated lookups
  private resolvedPaths: Map<string, string | null> = new Map()

  private eventRefs: EventRef[] = []
  private debouncedRebuild: () => void

  constructor(transactionsList: TransactionsList, accountsList: AccountsList) {
    this.transactionsList = transactionsList
    this.accountsList = accountsList
    this.debouncedRebuild = debounce(() => this.rebuild(), 300)

    this.startWatching()
    this.rebuild()
  }

  private resolveAccountPath(wikilink: string): string | null {
    if (!wikilink) return null

    const cached = this.resolvedPaths.get(wikilink)
    if (cached !== undefined) return cached

    const { app } = GlobalStore.getInstance()
    const linkPath = wikilinkToPath(wikilink)
    const file = app.metadataCache.getFirstLinkpathDest(linkPath, '')
    const resolved = file ? normalizePath(file.path) : null
    this.resolvedPaths.set(wikilink, resolved)
    return resolved
  }

  private getAmountForAccount(
    transaction: Transaction,
    accountPath: string,
    role: 'from' | 'to'
  ): number {
    // Multi-currency logic only applies to asset/liability accounts (they have a fixed currency).
    // Expense/revenue accounts are categories — they don't have a currency,
    // so they always use the transaction's primary amount.
    if (transaction.foreignAmount != null && transaction.foreignCurrency) {
      const account = this.accountsList.accounts.get(accountPath)
      const accountType = account?.accountType
      if (
        account?.currency &&
        (accountType === 'asset' || accountType === 'liability') &&
        account.currency === transaction.foreignCurrency
      ) {
        return role === 'from' ? -transaction.foreignAmount : transaction.foreignAmount
      }
    }

    return role === 'from' ? -transaction.amount! : transaction.amount!
  }

  rebuild(): void {
    this.accountEntries.clear()
    this.prefixSums.clear()
    this.resolvedPaths.clear()

    for (const transaction of this.transactionsList.transactions.values()) {
      const raw = toRaw(transaction)
      if (!raw.loaded || !raw.date || raw.amount == null) continue

      this.addTransactionEntries(raw)
    }

    for (const path of this.accountEntries.keys()) {
      this.sortAndComputePrefixSums(path)
    }
  }

  private addTransactionEntries(transaction: Transaction): void {
    const dateStr = transaction.date!.format(DATE_FORMAT)

    if (transaction.from) {
      const fromPath = this.resolveAccountPath(transaction.from)
      if (fromPath) {
        const startDate = this.getStartingBalanceDate(fromPath)
        if (!startDate || dateStr >= startDate) {
          this.addEntry(fromPath, {
            date: dateStr,
            amount: this.getAmountForAccount(transaction, fromPath, 'from'),
            transactionPath: transaction.transactionPath,
          })
        }
      }
    }

    if (transaction.to) {
      const toPath = this.resolveAccountPath(transaction.to)
      if (toPath) {
        const startDate = this.getStartingBalanceDate(toPath)
        if (!startDate || dateStr >= startDate) {
          this.addEntry(toPath, {
            date: dateStr,
            amount: this.getAmountForAccount(transaction, toPath, 'to'),
            transactionPath: transaction.transactionPath,
          })
        }
      }
    }
  }

  private addEntry(accountPath: string, entry: BalanceEntry): void {
    if (!this.accountEntries.has(accountPath)) {
      this.accountEntries.set(accountPath, [])
    }
    this.accountEntries.get(accountPath)!.push(entry)
  }

  private sortAndComputePrefixSums(accountPath: string): void {
    const entries = this.accountEntries.get(accountPath)
    if (!entries || entries.length === 0) {
      this.prefixSums.set(accountPath, [])
      return
    }

    entries.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date)
      if (dateCompare !== 0) return dateCompare
      return a.transactionPath.localeCompare(b.transactionPath)
    })

    const sums: number[] = new Array(entries.length)
    sums[0] = entries[0].amount
    for (let i = 1; i < entries.length; i++) {
      sums[i] = sums[i - 1] + entries[i].amount
    }

    this.prefixSums.set(accountPath, sums)
  }

  private getStartingBalance(accountPath: string): number {
    const account = this.accountsList.accounts.get(accountPath)
    return account?.startingBalance ?? 0
  }

  private getStartingBalanceDate(accountPath: string): string | null {
    const account = this.accountsList.accounts.get(accountPath)
    return account?.startingBalanceDate?.format(DATE_FORMAT) ?? null
  }

  private findIndexAtDate(entries: BalanceEntry[], dateStr: string): number {
    let lo = 0
    let hi = entries.length - 1
    let result = -1

    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (entries[mid].date <= dateStr) {
        result = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    return result
  }

  getBalanceAtDate(accountPath: string, date: dayjs.Dayjs): number {
    const dateStr = date.format(DATE_FORMAT)
    const startingBalance = this.getStartingBalance(accountPath)
    const startingDateStr = this.getStartingBalanceDate(accountPath)

    if (startingDateStr && dateStr < startingDateStr) {
      return 0
    }

    const entries = this.accountEntries.get(accountPath)
    const sums = this.prefixSums.get(accountPath)

    if (!entries || !sums || entries.length === 0) {
      return startingBalance
    }

    const index = this.findIndexAtDate(entries, dateStr)

    if (index < 0) {
      return startingBalance
    }

    return startingBalance + sums[index]
  }

  getBalanceSeries(
    accountPath: string,
    startDate: dayjs.Dayjs,
    endDate: dayjs.Dayjs
  ): Array<{ date: string; balance: number }> {
    const result: Array<{ date: string; balance: number }> = []
    let current = startDate

    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      result.push({
        date: current.format(DATE_FORMAT),
        balance: this.getBalanceAtDate(accountPath, current),
      })
      current = current.add(1, 'day')
    }

    return result
  }

  getNetWorthAtDate(date: dayjs.Dayjs): number {
    let netWorth = 0

    for (const [path, account] of this.accountsList.accounts) {
      if (account.accountType === 'asset') {
        netWorth += this.getBalanceAtDate(path, date)
      } else if (account.accountType === 'liability') {
        netWorth -= this.getBalanceAtDate(path, date)
      }
    }

    return netWorth
  }

  getTotalForPeriod(params: {
    startDate: dayjs.Dayjs
    endDate: dayjs.Dayjs
    accountPath?: string
    categoryPath?: string
    direction?: 'from' | 'to'
  }): number {
    const startStr = params.startDate.format(DATE_FORMAT)
    const endStr = params.endDate.format(DATE_FORMAT)
    let total = 0

    for (const transaction of this.transactionsList.transactions.values()) {
      const raw = toRaw(transaction)
      if (!raw.loaded || !raw.date || raw.amount == null) continue

      const dateStr = raw.date.format(DATE_FORMAT)
      if (dateStr < startStr || dateStr > endStr) continue

      if (params.categoryPath && raw.category) {
        const catPath = this.resolveAccountPath(raw.category)
        if (catPath !== params.categoryPath) continue
      } else if (params.categoryPath) {
        continue
      }

      if (params.accountPath) {
        const fromPath = raw.from ? this.resolveAccountPath(raw.from) : null
        const toPath = raw.to ? this.resolveAccountPath(raw.to) : null

        if (params.direction === 'from' && fromPath === params.accountPath) {
          total += raw.amount
        } else if (params.direction === 'to' && toPath === params.accountPath) {
          total += raw.amount
        } else if (!params.direction) {
          if (fromPath === params.accountPath) total -= raw.amount
          if (toPath === params.accountPath) total += raw.amount
        }
      } else {
        total += raw.amount
      }
    }

    return total
  }

  private startWatching(): void {
    const { app } = GlobalStore.getInstance()

    // Rebuild when metadataCache resolves (initial load + bulk changes)
    this.eventRefs.push(
      app.metadataCache.on('resolved', () => {
        this.debouncedRebuild()
      })
    )

    // Rebuild when individual files change
    this.eventRefs.push(
      app.metadataCache.on('changed', (file: TFile) => {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter
        if (fm?.type === 'transaction' || fm?.type === 'account') {
          this.debouncedRebuild()
        }
      })
    )

    // Rebuild when tracked transaction or account files are deleted
    this.eventRefs.push(
      app.vault.on('delete', (file) => {
        if (!(file instanceof TFile)) return
        const path = normalizePath(file.path)
        if (this.transactionsList.transactions.has(path) || this.accountsList.accounts.has(path)) {
          this.debouncedRebuild()
        }
      })
    )
  }

  cleanup(): void {
    const { app } = GlobalStore.getInstance()

    this.eventRefs.forEach((ref) => {
      const rawRef = toRaw(ref)
      app.vault.offref(rawRef)
      app.metadataCache.offref(rawRef)
    })
    this.eventRefs = []

    this.accountEntries.clear()
    this.prefixSums.clear()
    this.resolvedPaths.clear()
  }
}
