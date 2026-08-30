<template>
  <div class="abele-transactions-list">
    <div class="abele-transactions-list__header">
      <div class="abele-transactions-list__header-text">Transactions</div>
      <ObsidianIcon icon="banknote-arrow-down" @click="addTransaction()" />
    </div>
    <div v-if="visible.length" class="abele-transactions-list__items">
      <template v-for="(tx, idx) in visible" :key="tx.id">
        <DateDivider v-if="showDateBefore(idx)" :date="txDate(tx)">
          <span v-for="s in dayTotals(txDate(tx))" :key="s" style="margin-left: 0.5em">{{
            s
          }}</span>
        </DateDivider>
        <TransactionItem :transaction="tx" :tx-type="getType(tx)" />
      </template>
      <div ref="scrollSentinel" class="abele-transactions-list__sentinel" />
    </div>
    <div v-if="!sorted.length" class="abele-transactions-list__empty">No transactions.</div>
  </div>
</template>

<script setup lang="ts">
import { Transaction } from '@/entities/Transaction'
import { AccountsList } from '@/entities/AccountsList'
import { GlobalStore } from '@/stores/GlobalStore'
import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import TransactionItem from './TransactionItem.vue'
import DateDivider from './obsidian/DateDivider.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { createTransaction } from '@/commands/createTransaction'
import { DATE_FORMAT } from '@/constants/dates'
import { computed, ref, unref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import dayjs from 'dayjs'
import { formatAmount } from '@/helpers/moneyFormat'

const PAGE_SIZE = 20

const props = defineProps<{
  transactions: Transaction[]
  date?: dayjs.Dayjs | null
  accountPath?: string | null
}>()

const store = GlobalStore.getInstance()

const accountTypeSets = computed(() => {
  const al = unref(store.accountsList) as AccountsList | null
  const asset = new Set<string>()
  const expense = new Set<string>()
  const revenue = new Set<string>()
  if (!al) return { asset, expense, revenue }

  for (const [path, account] of al.accounts) {
    if (account.accountType === 'asset') asset.add(path)
    if (account.accountType === 'expense') expense.add(path)
    if (account.accountType === 'revenue') revenue.add(path)
  }
  return { asset, expense, revenue }
})

function resolveWikilink(wikilink: string): string | null {
  const linkPath = wikilinkToPath(wikilink)
  if (!linkPath) return null
  const file = store.app.metadataCache.getFirstLinkpathDest(linkPath, '')
  return file ? file.path : null
}

function getType(tx: Transaction): 'income' | 'expense' | 'transfer' {
  const { expense, revenue } = accountTypeSets.value
  const toPath = tx.to ? resolveWikilink(tx.to) : null
  const fromPath = tx.from ? resolveWikilink(tx.from) : null

  if (toPath && expense.has(toPath)) return 'expense'
  if (fromPath && revenue.has(fromPath)) return 'income'
  return 'transfer'
}

const sorted = computed(() => {
  const { app } = store
  return [...props.transactions].sort((a, b) => {
    const da = a.date ? a.date.format('YYYY-MM-DD') : ''
    const db = b.date ? b.date.format('YYYY-MM-DD') : ''
    const dateCmp = db.localeCompare(da)
    if (dateCmp !== 0) return dateCmp

    const fa = app.vault.getAbstractFileByPath(a.transactionPath)
    const fb = app.vault.getAbstractFileByPath(b.transactionPath)
    const ca = (fa as any)?.stat?.ctime ?? 0
    const cb = (fb as any)?.stat?.ctime ?? 0
    return cb - ca
  })
})

const visibleCount = ref(PAGE_SIZE)
const visible = computed(() => sorted.value.slice(0, visibleCount.value))

const scrollSentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(scrollSentinel, ([entry]) => {
  if (entry?.isIntersecting && sorted.value.length > visibleCount.value) {
    visibleCount.value += PAGE_SIZE
  }
})

const txDate = (tx: Transaction): string => {
  return tx.date?.format(DATE_FORMAT) ?? ''
}

const showDateBefore = (idx: number): boolean => {
  if (idx === 0) return true
  return txDate(visible.value[idx]) !== txDate(visible.value[idx - 1])
}

const isAssetToAsset = (tx: Transaction): boolean => {
  const { asset } = accountTypeSets.value
  const toPath = tx.to ? resolveWikilink(tx.to) : null
  const fromPath = tx.from ? resolveWikilink(tx.from) : null
  return !!(toPath && asset.has(toPath) && fromPath && asset.has(fromPath))
}

const dayTotals = (date: string): string[] => {
  const byCurrency = new Map<string, number>()
  for (const tx of sorted.value) {
    if (txDate(tx) !== date) continue
    if (isAssetToAsset(tx)) continue
    const cur = tx.currency || '?'
    const sign = getType(tx) === 'income' ? 1 : -1
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + sign * (tx.amount || 0))
  }
  return Array.from(byCurrency.entries()).map(
    ([cur, amount]) =>
      `${amount >= 0 ? '+' : ''}${formatAmount(amount)} ${cur}`
  )
}

function addTransaction() {
  const al = unref(store.accountsList) as AccountsList | null
  const account = props.accountPath && al ? al.accounts.get(props.accountPath) : null

  let from: string | undefined
  let to: string | undefined

  if (account) {
    const wikilink = pathToWikilink(props.accountPath!)
    if (account.accountType === 'revenue') {
      from = wikilink
    } else {
      to = wikilink
    }
  }

  createTransaction({
    date: props.date ?? undefined,
    from,
    to,
  })
}
</script>

<style lang="scss">
.abele-transactions-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: var(--p-spacing);

  .abele-transactions-list__header-text {
    font-weight: bold;
  }
}

.abele-transactions-list__items {
  display: flex;
  flex-direction: column;
}

.abele-transactions-list__sentinel {
  height: 1px;
}

.abele-transactions-list__empty {
  font-style: italic;
  color: var(--text-muted);
}
</style>
