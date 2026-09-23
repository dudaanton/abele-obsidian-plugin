import { DATE_FORMAT } from '@/constants/dates'
import type { Transaction } from '@/entities/Transaction'
import type { TransactionsList } from '@/entities/TransactionsList'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  effect,
  onScopeDispose,
  shallowRef,
  stop as stopEffect,
  toRaw,
  unref,
  watch,
  type ReactiveEffectRunner,
  type Ref,
  type ShallowRef,
} from 'vue'

/**
 * One transaction as the finance screens read it: the date already formatted, the accounts
 * already resolved to paths. Doing that once per change instead of once per chart, per sort
 * comparison and per date heading is most of what made adding a transaction freeze the
 * sidebar.
 */
export interface LedgerEntry {
  /** The live transaction, for the components that render one. */
  tx: Transaction
  id: string
  /** YYYY-MM-DD */
  date: string
  /** When the note was created — the order within a day. */
  ctime: number
  from: string | null
  to: string | null
  amount: number | null
  currency: string | null
}

/**
 * Every loaded, dated transaction, newest first (by date, then by when its note was created).
 * Link resolution is memoised for the whole pass: a vault has thousands of transactions but
 * a few dozen accounts, so it costs one lookup per account rather than two per transaction.
 */
export function buildLedger(
  transactions: Iterable<Transaction>,
  resolveLink: (wikilink: string) => string | null,
  ctimeOf: (path: string) => number
): LedgerEntry[] {
  const resolved = new Map<string, string | null>()
  const resolve = (wikilink: string | null): string | null => {
    if (!wikilink) return null
    let path = resolved.get(wikilink)
    if (path === undefined) {
      path = resolveLink(wikilink)
      resolved.set(wikilink, path)
    }
    return path
  }

  const entries: LedgerEntry[] = []
  for (const live of transactions) {
    const raw = toRaw(live)
    if (!raw.loaded || !raw.date) continue
    entries.push({
      tx: live,
      id: raw.id,
      date: raw.date.format(DATE_FORMAT),
      ctime: ctimeOf(raw.transactionPath),
      from: resolve(raw.from),
      to: resolve(raw.to),
      amount: raw.amount,
      currency: raw.currency,
    })
  }

  entries.sort((a, b) => (a.date === b.date ? b.ctime - a.ctime : a.date < b.date ? 1 : -1))
  return entries
}

/** Reads every field a ledger entry is built from, so a watcher sees any of them change. */
function touchTransactions(tl: TransactionsList): number {
  let count = 0
  for (const tx of tl.transactions.values()) {
    void tx.loaded
    void tx.date
    void tx.from
    void tx.to
    void tx.amount
    void tx.currency
    count++
  }
  return count
}

/** How long a burst of changes is left to settle before the ledger is rebuilt. */
export const LEDGER_SETTLE_MS = 250

export interface FinanceLedger {
  entries: ShallowRef<LedgerEntry[]>
  /** How many times the ledger has been rebuilt — what the performance tests count. */
  rebuilds: Ref<number>
}

/**
 * The transactions a finance screen shows, rebuilt at most once per burst of changes and
 * not at all while the screen is out of sight.
 *
 * Adding one transaction touches it several times over — the note is created, loaded,
 * renamed by its template (which drops and re-adds it), and reloaded when its currency is
 * filled in. Each of those used to re-sort and re-resolve every transaction in the vault.
 *
 * `active` is whether the screen is visible. While it is false nothing is watched; when it
 * turns true the ledger is rebuilt once, so the screen is current the moment it is seen.
 */
export function useFinanceLedger(
  active: Ref<boolean>,
  settleMs: number = LEDGER_SETTLE_MS
): FinanceLedger {
  const store = GlobalStore.getInstance()
  const entries = shallowRef<LedgerEntry[]>([])
  const rebuilds = shallowRef(0)

  const resolveLink = (wikilink: string): string | null => {
    const linkPath = wikilinkToPath(wikilink)
    if (!linkPath) return null
    return store.app.metadataCache.getFirstLinkpathDest(linkPath, '')?.path ?? null
  }
  const ctimeOf = (path: string): number => {
    const file = store.app.vault.getAbstractFileByPath(path) as { stat?: { ctime?: number } }
    return file?.stat?.ctime ?? 0
  }

  // Subscribes to every transaction field the ledger reads, without doing anything else:
  // a change only schedules a rebuild, and the rebuild re-subscribes (new transactions
  // included). So a burst of changes costs one cheap notification each and a single rebuild.
  let tracker: ReactiveEffectRunner | null = null

  const rebuild = (retrack = true): void => {
    if (retrack) tracker?.()
    const tl = toRaw(unref(store.transactionsList)) as TransactionsList | null
    entries.value = tl ? buildLedger(tl.transactions.values(), resolveLink, ctimeOf) : []
    rebuilds.value++
  }

  // Trailing, and restarted by every change, so a burst settles into one rebuild.
  let timer: number | null = null
  const cancelRebuild = (): void => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
  }
  const scheduleRebuild = (): void => {
    cancelRebuild()
    timer = window.setTimeout(() => {
      timer = null
      rebuild()
    }, settleMs)
  }

  const start = (): void => {
    if (tracker) return
    tracker = effect(
      () => {
        const tl = unref(store.transactionsList) as TransactionsList | null
        if (tl) touchTransactions(tl)
      },
      { scheduler: scheduleRebuild }
    )
    rebuild(false)
  }
  const stop = (): void => {
    if (tracker) stopEffect(tracker)
    tracker = null
    cancelRebuild()
  }

  watch(active, (on) => (on ? start() : stop()), { immediate: true })
  onScopeDispose(stop)

  return { entries, rebuilds }
}
