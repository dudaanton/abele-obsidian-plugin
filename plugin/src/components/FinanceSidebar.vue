<template>
  <div class="abele-finance-sidebar">
    <!-- Period Summary -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">{{ currentMonthLabel }}</h3>
      <div class="abele-finance-sidebar__summary">
        <div class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Income</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--income"
          >
            {{ formatAmount(periodIncome) }}
          </span>
        </div>
        <div class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Expenses</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--expense"
          >
            {{ formatAmount(periodExpenses) }}
          </span>
        </div>
        <div class="abele-finance-sidebar__summary-row abele-finance-sidebar__summary-row--total">
          <span class="abele-finance-sidebar__summary-label">Savings</span>
          <span
            class="abele-finance-sidebar__summary-value"
            :class="{
              'abele-finance-sidebar__summary-value--income': periodSavings >= 0,
              'abele-finance-sidebar__summary-value--expense': periodSavings < 0,
            }"
          >
            {{ formatAmount(periodSavings) }}
          </span>
        </div>
      </div>
    </section>

    <!-- Account Balances -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">Accounts</h3>
      <div v-if="assetAccounts.length" class="abele-finance-sidebar__accounts-group">
        <div
          v-for="item in assetAccounts"
          :key="item.path"
          class="abele-finance-sidebar__account-row"
          @click="openNote(item.path)"
        >
          <span class="abele-finance-sidebar__account-name" :title="item.name">{{
            item.name
          }}</span>
          <span class="abele-finance-sidebar__account-balance">
            {{ formatAmount(item.balance) }}
            <span class="abele-finance-sidebar__account-currency">{{ item.currency }}</span>
          </span>
        </div>
      </div>
      <div v-if="liabilityAccounts.length" class="abele-finance-sidebar__accounts-group">
        <div class="abele-finance-sidebar__group-label">Liabilities</div>
        <div
          v-for="item in liabilityAccounts"
          :key="item.path"
          class="abele-finance-sidebar__account-row"
          @click="openNote(item.path)"
        >
          <span class="abele-finance-sidebar__account-name" :title="item.name">{{
            item.name
          }}</span>
          <span
            class="abele-finance-sidebar__account-balance abele-finance-sidebar__summary-value--expense"
          >
            {{ formatAmount(item.balance) }}
            <span class="abele-finance-sidebar__account-currency">{{ item.currency }}</span>
          </span>
        </div>
      </div>
      <div
        v-if="!assetAccounts.length && !liabilityAccounts.length"
        class="abele-finance-sidebar__empty"
      >
        No accounts found
      </div>
    </section>

    <!-- Quick Add Transaction -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">Quick Add</h3>
      <form class="abele-finance-sidebar__quick-add" @submit.prevent="submitTransaction">
        <input
          v-model="quickAdd.title"
          type="text"
          placeholder="Description"
          class="abele-finance-sidebar__input"
        />
        <div class="abele-finance-sidebar__quick-add-row">
          <input
            v-model="quickAdd.amount"
            type="number"
            step="0.01"
            placeholder="Amount"
            class="abele-finance-sidebar__input abele-finance-sidebar__input--amount"
          />
          <input
            v-model="quickAdd.currency"
            type="text"
            placeholder="EUR"
            class="abele-finance-sidebar__input abele-finance-sidebar__input--currency"
          />
        </div>
        <input
          v-model="quickAdd.from"
          type="text"
          placeholder="From account"
          class="abele-finance-sidebar__input"
        />
        <input
          v-model="quickAdd.to"
          type="text"
          placeholder="To account"
          class="abele-finance-sidebar__input"
        />
        <input
          v-model="quickAdd.category"
          type="text"
          placeholder="Category (optional)"
          class="abele-finance-sidebar__input"
        />
        <button type="submit" class="abele-finance-sidebar__submit" :disabled="!canSubmit">
          Add Transaction
        </button>
      </form>
    </section>

    <!-- Recent Transactions -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">Recent Transactions</h3>
      <div v-if="visibleTransactions.length" class="abele-finance-sidebar__transactions">
        <div
          v-for="tx in visibleTransactions"
          :key="tx.path"
          class="abele-finance-sidebar__transaction-row"
          @click="openNote(tx.path)"
        >
          <div class="abele-finance-sidebar__transaction-main">
            <span class="abele-finance-sidebar__transaction-title">{{ tx.title }}</span>
            <span class="abele-finance-sidebar__transaction-amount">
              {{ formatAmount(tx.amount) }}
              <span class="abele-finance-sidebar__account-currency">{{ tx.currency }}</span>
            </span>
          </div>
          <div class="abele-finance-sidebar__transaction-meta">
            <span>{{ tx.from }} → {{ tx.to }}</span>
            <span>{{ tx.date }}</span>
          </div>
        </div>
        <button v-if="hasMore" class="abele-finance-sidebar__load-more" @click="loadMore">
          Load more
        </button>
      </div>
      <div v-else class="abele-finance-sidebar__empty">No transactions found</div>
    </section>

    <!-- Links to .base views -->
    <section class="abele-finance-sidebar__section">
      <div class="abele-finance-sidebar__links">
        <a class="abele-finance-sidebar__link" @click="openBaseFile('Finance/Transactions.base')">
          Transactions table
        </a>
        <a class="abele-finance-sidebar__link" @click="openBaseFile('Finance/Accounts.base')">
          Accounts overview
        </a>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { Account } from '@/entities/Account'
import { Transaction } from '@/entities/Transaction'
import { createTransaction } from '@/commands/createTransaction'
import { AbeleConfig } from '@/services/AbeleConfig'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { Notice, TFile } from 'obsidian'

const PAGE_SIZE = 20
const visibleCount = ref(PAGE_SIZE)

const store = GlobalStore.getInstance()

const quickAdd = reactive({
  title: '',
  amount: '',
  currency: AbeleConfig.getInstance().defaultCurrency || 'EUR',
  from: '',
  to: '',
  category: '',
})

const currentMonthLabel = computed(() => dayjs().format('MMMM YYYY'))

const accountsList = computed(() => unref(store.accountsList) as AccountsList | null)
const transactionsList = computed(() => unref(store.transactionsList) as TransactionsList | null)
const balanceIndex = computed(() => unref(store.balanceIndex) as BalanceIndex | null)

// --- Account Balances ---

interface AccountRow {
  path: string
  name: string
  balance: number
  currency: string
  type: string
}

function buildAccountRow(path: string, account: Account): AccountRow {
  const bi = balanceIndex.value
  const balance = bi ? bi.getBalanceAtDate(path, dayjs()) : 0
  return {
    path,
    name: account.accountName || account.title || path.split('/').pop() || path,
    balance,
    currency: account.currency || '',
    type: account.accountType || '',
  }
}

const allAccountRows = computed<AccountRow[]>(() => {
  const al = accountsList.value
  if (!al) return []

  const rows: AccountRow[] = []
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'asset' || account.accountType === 'liability') {
      rows.push(buildAccountRow(path, account))
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
})

const assetAccounts = computed(() => allAccountRows.value.filter((a) => a.type === 'asset'))
const liabilityAccounts = computed(() => allAccountRows.value.filter((a) => a.type === 'liability'))

// --- Period Summary ---

const periodStart = computed(() => dayjs().startOf('month'))
const periodEnd = computed(() => dayjs().endOf('month'))

const periodIncome = computed(() => {
  const bi = balanceIndex.value
  const al = accountsList.value
  if (!bi || !al) return 0

  let income = 0
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'revenue') {
      income += bi.getTotalForPeriod({
        startDate: periodStart.value,
        endDate: periodEnd.value,
        accountPath: path,
        direction: 'from',
      })
    }
  }
  return income
})

const periodExpenses = computed(() => {
  const bi = balanceIndex.value
  const al = accountsList.value
  if (!bi || !al) return 0

  let expenses = 0
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'expense') {
      expenses += bi.getTotalForPeriod({
        startDate: periodStart.value,
        endDate: periodEnd.value,
        accountPath: path,
        direction: 'to',
      })
    }
  }
  return expenses
})

const periodSavings = computed(() => periodIncome.value - periodExpenses.value)

// --- Recent Transactions ---

interface TransactionRow {
  path: string
  title: string
  amount: number
  currency: string
  from: string
  to: string
  date: string
  sortDate: string
}

const sortedTransactions = computed<TransactionRow[]>(() => {
  const tl = transactionsList.value
  if (!tl) return []

  const rows: TransactionRow[] = []
  for (const [path, tx] of tl.transactions) {
    if (!tx.loaded || !tx.date) continue
    rows.push({
      path,
      title: tx.title || tx.transactionName || 'Transaction',
      amount: tx.amount ?? 0,
      currency: tx.currency || '',
      from: tx.from ? extractAliasOrNameFromWikilink(tx.from) || tx.from : '',
      to: tx.to ? extractAliasOrNameFromWikilink(tx.to) || tx.to : '',
      date: tx.date.format(DISPLAY_DATE_FORMAT),
      sortDate: tx.date.format('YYYY-MM-DD'),
    })
  }

  return rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
})

const visibleTransactions = computed(() => sortedTransactions.value.slice(0, visibleCount.value))
const hasMore = computed(() => sortedTransactions.value.length > visibleCount.value)

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

// --- Quick Add ---

const canSubmit = computed(() => {
  return quickAdd.amount && quickAdd.from && quickAdd.to
})

async function submitTransaction() {
  if (!canSubmit.value) return

  const wrapWikilink = (s: string) => (s.startsWith('[[') ? s : `[[${s}]]`)

  try {
    await createTransaction(
      {
        title: quickAdd.title || undefined,
        amount: parseFloat(quickAdd.amount),
        currency: quickAdd.currency || AbeleConfig.getInstance().defaultCurrency || 'EUR',
        from: wrapWikilink(quickAdd.from),
        to: wrapWikilink(quickAdd.to),
        category: quickAdd.category ? wrapWikilink(quickAdd.category) : undefined,
        date: dayjs(),
      },
      false
    )

    // Reset form
    quickAdd.title = ''
    quickAdd.amount = ''
    quickAdd.from = ''
    quickAdd.to = ''
    quickAdd.category = ''

    new Notice('Transaction created')
  } catch (e) {
    new Notice('Failed to create transaction')
    console.error('Failed to create transaction', e)
  }
}

// --- Navigation ---

function openNote(path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  }
}

function openBaseFile(path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  } else {
    new Notice(`File not found: ${path}`)
  }
}

// --- Formatting ---

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
</script>

<style lang="scss">
.abele-finance-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);

  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));
}

@media (max-width: 600px) {
  .abele-finance-sidebar {
    padding: calc(var(--size-4-4));
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}

.abele-finance-sidebar__section {
  margin-bottom: calc(var(--p-spacing) * 2);
}

.abele-finance-sidebar__section-title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--size-4-2) 0;
}

// --- Summary ---

.abele-finance-sidebar__summary {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-ui-small);
}

.abele-finance-sidebar__summary-row--total {
  border-top: 1px solid var(--background-modifier-border);
  padding-top: var(--size-4-1);
  font-weight: var(--font-semibold);
}

.abele-finance-sidebar__summary-label {
  color: var(--text-muted);
}

.abele-finance-sidebar__summary-value {
  font-variant-numeric: tabular-nums;
}

.abele-finance-sidebar__summary-value--income {
  color: var(--text-success);
}

.abele-finance-sidebar__summary-value--expense {
  color: var(--text-error);
}

// --- Accounts ---

.abele-finance-sidebar__accounts-group {
  margin-bottom: var(--size-4-2);
}

.abele-finance-sidebar__group-label {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  margin-bottom: var(--size-4-1);
}

.abele-finance-sidebar__account-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-4-1) 0;
  cursor: pointer;
  border-radius: var(--radius-s);
  font-size: var(--font-ui-small);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-finance-sidebar__account-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.abele-finance-sidebar__account-balance {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: var(--size-4-2);
}

.abele-finance-sidebar__account-currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

// --- Quick Add ---

.abele-finance-sidebar__quick-add {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__quick-add-row {
  display: flex;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__input {
  width: 100%;
  padding: var(--size-4-1) var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);

  &::placeholder {
    color: var(--text-faint);
  }

  &:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
}

.abele-finance-sidebar__input--amount {
  flex: 1;
}

.abele-finance-sidebar__input--currency {
  width: 60px;
  flex: none;
}

.abele-finance-sidebar__submit {
  padding: var(--size-4-1) var(--size-4-2);
  border: none;
  border-radius: var(--radius-s);
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  font-size: var(--font-ui-small);
  cursor: pointer;

  &:hover {
    background-color: var(--interactive-accent-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// --- Transactions ---

.abele-finance-sidebar__transactions {
  display: flex;
  flex-direction: column;
}

.abele-finance-sidebar__transaction-row {
  padding: var(--size-4-1) 0;
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-finance-sidebar__transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-ui-small);
}

.abele-finance-sidebar__transaction-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.abele-finance-sidebar__transaction-amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: var(--size-4-2);
}

.abele-finance-sidebar__transaction-meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  margin-top: 2px;
}

.abele-finance-sidebar__load-more {
  margin-top: var(--size-4-2);
  padding: var(--size-4-1);
  border: 1px dashed var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: none;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  cursor: pointer;
  text-align: center;

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}

// --- Links ---

.abele-finance-sidebar__links {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__link {
  font-size: var(--font-ui-small);
  color: var(--text-accent);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

// --- Empty ---

.abele-finance-sidebar__empty {
  font-size: var(--font-ui-small);
  color: var(--text-faint);
  font-style: italic;
}
</style>
