<template>
  <ObsidianModal
    :title="path ? 'Edit transaction' : 'New transaction'"
    size="tall"
    @close="onDialogClosed"
  >
    <div class="abele-entry-form abele-transaction-form" @keydown="onKeydown">
      <div class="abele-entry-form__body">
        <ObsidianInput
          ref="titleInput"
          v-model="values.title"
          class="abele-entry-form__title"
          placeholder="What for"
        />

        <div class="abele-entry-form__label">Amount</div>
        <div class="abele-transaction-form__money">
          <AmountField
            ref="amountField"
            :model-value="values.amount"
            keys
            @update:model-value="onAmount"
          />
          <ObsidianInput
            class="abele-transaction-form__currency"
            :model-value="values.currency ?? ''"
            :placeholder="defaultCurrency || 'Currency'"
            @update:model-value="onCurrency"
          />
        </div>

        <div class="abele-entry-form__row">
          <span class="abele-entry-form__row-name">Date</span>
          <ObsidianButton
            :text="dateText"
            icon="calendar-days"
            tooltip="Choose the day of the transaction"
            @click="pickerOpen = true"
          />
        </div>

        <div class="abele-entry-form__label">From</div>
        <LinkField
          v-model="values.from"
          :options="(q: string) => accountOptions(q, 'from')"
          placeholder="Wallet or income"
        />
        <div v-if="fromContext" class="abele-transaction-form__context">{{ fromContext }}</div>

        <div class="abele-entry-form__label">To</div>
        <LinkField
          v-model="values.to"
          :options="(q: string) => accountOptions(q, 'to')"
          placeholder="Wallet or spending"
        />
        <div v-if="toContext" class="abele-transaction-form__context">{{ toContext }}</div>

        <template v-if="values.foreignCurrency">
          <div class="abele-entry-form__label">Received in {{ values.foreignCurrency }}</div>
          <AmountField :model-value="values.foreignAmount" @update:model-value="onForeignAmount" />
          <div class="abele-entry-form__label">Exchange rate</div>
          <div class="abele-transaction-form__money">
            <span class="abele-transaction-form__rate-unit">1 {{ values.currency }} =</span>
            <AmountField :model-value="rate" placeholder="Rate" @update:model-value="onRate" />
            <span class="abele-transaction-form__rate-unit">{{ values.foreignCurrency }}</span>
          </div>
          <div v-if="lastRateText" class="abele-transaction-form__context">{{ lastRateText }}</div>
        </template>

        <div class="abele-entry-form__label">Category</div>
        <LinkField v-model="values.category" :options="categoryOptions" placeholder="None" />

        <div class="abele-entry-form__label">Groups</div>
        <PropertyListField
          v-model="values.groups"
          property-key="groups"
          placeholder="A trip, a project, a person"
        />

        <div class="abele-entry-form__label">Description</div>
        <NoteEditorField
          v-model="values.description"
          placeholder="Details, links…"
          @submit="save"
        />
      </div>

      <div v-if="lastSaved" class="abele-transaction-form__saved">Saved “{{ lastSaved }}”</div>

      <div class="abele-entry-form__buttons">
        <ObsidianButton
          text="Open as note"
          icon="file-text"
          :disabled="saving"
          tooltip="Save and open the transaction as a note"
          @click="openAsNote"
        />
        <span class="abele-entry-form__spacer" />
        <ObsidianButton
          class="abele-entry-form__cancel"
          text="Cancel"
          tooltip="Close without saving"
          @click="close"
        />
        <ObsidianButton
          text="Next"
          icon="copy-plus"
          :disabled="saving"
          tooltip="Save, then start another on the same day between the same accounts"
          @click="saveAndNext"
        />
        <ObsidianButton
          text="Save"
          accent
          :disabled="saving"
          tooltip="Save the transaction (Ctrl/Cmd+Enter)"
          @click="save"
        />
      </div>
    </div>

    <DateTimePickerModal
      v-if="pickerOpen"
      mode="event"
      heading="Transaction date"
      date-only
      :initial-date="dayjs(values.date)"
      @confirm="onPicked"
      @clear="pickerOpen = false"
      @cancel="pickerOpen = false"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * The transaction dialog: the amount with a calculator, the accounts on both sides with what
 * the money does to their balances, the second amount and the rate when the accounts are in
 * different currencies, and the description in Obsidian's own note editor. "Next" saves and
 * starts another on the same day between the same accounts, for a receipt of several lines.
 */
import { computed, onMounted, reactive, ref, toRaw, unref, watch } from 'vue'
import dayjs from 'dayjs'
import { Notice, TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianInput from './obsidian/Input.vue'
import ObsidianButton from './obsidian/Button.vue'
import NoteEditorField from './NoteEditorField.vue'
import AmountField from './AmountField.vue'
import LinkField, { type LinkOption } from './LinkField.vue'
import PropertyListField from './PropertyListField.vue'
import DateTimePickerModal from './DateTimePickerModal.vue'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import type { TransactionFormValues } from '@/helpers/entryForms'
import { saveTransactionForm } from '@/commands/transactionFormNote'
import { walletCurrencies } from '@/commands/createTransaction'
import { openFile } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AccountsList } from '@/entities/AccountsList'
import type { BalanceIndex } from '@/entities/BalanceIndex'
import type { TransactionsList } from '@/entities/TransactionsList'
import { holdsBalance, walletEffect, walletOptions } from '@/helpers/walletContext'
import { applyRate, lastUsedRate, rateBetween } from '@/helpers/exchangeRate'
import { formatAmount } from '@/helpers/moneyFormat'
import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'

const props = defineProps<{
  /** The note being edited; none for a new transaction. */
  path?: string
  initial: TransactionFormValues
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', path: string): void
}>()

const store = GlobalStore.getInstance()
const config = AbeleConfig.getInstance()
const defaultCurrency = config.defaultCurrency

const values = reactive<TransactionFormValues>({
  ...props.initial,
  groups: [...props.initial.groups],
})
const editing = ref(props.path)
const titleInput = ref<{ $el: HTMLInputElement } | null>(null)
const pickerOpen = ref(false)
const saving = ref(false)
const lastSaved = ref('')
/** The currency was typed by hand, so the accounts no longer decide it. */
const currencyTouched = ref(false)
let closed = false

const accounts = () => (unref(store.accountsList) as AccountsList | null)?.accounts ?? new Map()

const accountOptions = (query: string, side: 'from' | 'to'): LinkOption[] =>
  walletOptions(accounts(), query, side).map((o) => ({
    link: o.link,
    name: o.name,
    detail: [o.currency, balanceOf(o.path, o.type, o.currency)].filter(Boolean).join(' · '),
  }))

const categoryOptions = (query: string): LinkOption[] => {
  const folder = config.financeCategoriesFolder?.replace(/\/$/, '')
  if (!folder) return []
  const q = query.trim().toLowerCase()
  return store.app.vault
    .getMarkdownFiles()
    .filter((f: TFile) => f.path.startsWith(`${folder}/`))
    .filter((f: TFile) => !q || f.basename.toLowerCase().includes(q))
    .sort((a: TFile, b: TFile) => a.basename.localeCompare(b.basename))
    .slice(0, 50)
    .map((f: TFile) => ({ link: pathToWikilink(f.path), name: f.basename }))
}

/** The account a link points at, and its path. */
const accountAt = (link: string | null) => {
  if (!link) return null
  const target = wikilinkToPath(link)
  if (!target) return null
  const file = store.app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/, ''), '')
  if (!file) return null
  const account = accounts().get(file.path)
  return account ? { path: file.path, account } : null
}

const balanceIndex = () => toRaw(unref(store.balanceIndex)) as BalanceIndex | null

function balanceOf(path: string, type: string | null, currency: string | null): string {
  const bi = balanceIndex()
  if (!bi || !holdsBalance(type as never)) return ''
  void bi.version.value
  return `${formatAmount(bi.getBalanceAtDate(path, dayjs(values.date)))}${currency ? ` ${currency}` : ''}`
}

/** "Card: 1 234,00 EUR → 1 230,50 EUR" — what the wallet holds that day, and after this. */
const walletContext = (side: 'from' | 'to') => {
  const found = accountAt(values[side])
  if (!found || !holdsBalance(found.account.accountType)) return ''
  const bi = balanceIndex()
  if (!bi) return ''
  void bi.version.value
  const currency = found.account.currency
  const unit = currency ? ` ${currency}` : ''
  const before = bi.getBalanceAtDate(found.path, dayjs(values.date))
  const label = `Balance on ${dayjs(values.date).format(DISPLAY_DATE_FORMAT)}: ${formatAmount(before)}${unit}`
  // An existing transaction is already in that balance; only a new one has an "after".
  if (editing.value) return label
  const effect = walletEffect(side, values, currency)
  return effect === null ? label : `${label} → ${formatAmount(before + effect)}${unit}`
}

const fromContext = computed(() => walletContext('from'))
const toContext = computed(() => walletContext('to'))

const dateText = computed(() => dayjs(values.date).format(DISPLAY_DATE_FORMAT))

// ── Currencies and the rate ──

/**
 * The accounts decide the currencies, until one is typed by hand. Accounts with no currency of
 * their own leave whatever the transaction already had — the currencies "Add next" carried over.
 */
watch(
  () => [values.from, values.to],
  () => {
    if (currencyTouched.value) return
    const wallets = walletCurrencies(values.from, values.to)
    if (wallets.currency) {
      values.currency = wallets.currency
      values.foreignCurrency = wallets.foreignCurrency
      if (!wallets.foreignCurrency) values.foreignAmount = null
    } else if (!values.currency) {
      values.currency = defaultCurrency || null
    }
  },
  { immediate: !props.path }
)

const rate = ref<number | null>(rateBetween(values.amount, values.foreignAmount))

const lastRate = computed(() => {
  if (!values.currency || !values.foreignCurrency) return null
  const list = unref(store.transactionsList) as TransactionsList | null
  if (!list) return null
  return lastUsedRate(list.transactions.values(), values.currency, values.foreignCurrency)
})

const lastRateText = computed(() =>
  lastRate.value
    ? `Last used ${lastRate.value.rate} on ${dayjs(lastRate.value.date).format(DISPLAY_DATE_FORMAT)}`
    : ''
)

// A pair of currencies with no rate yet starts from the one last used between them.
watch(
  () => [values.currency, values.foreignCurrency],
  () => {
    if (rate.value === null && lastRate.value) {
      rate.value = lastRate.value.rate
      values.foreignAmount = applyRate(values.amount, rate.value)
    }
  },
  { immediate: true }
)

const onAmount = (amount: number | null) => {
  values.amount = amount
  if (values.foreignCurrency && rate.value !== null) {
    values.foreignAmount = applyRate(amount, rate.value)
  }
}

const onForeignAmount = (amount: number | null) => {
  values.foreignAmount = amount
  const next = rateBetween(values.amount, amount)
  if (next !== null) rate.value = next
}

const onRate = (next: number | null) => {
  rate.value = next
  values.foreignAmount = applyRate(values.amount, next)
}

const onCurrency = (currency: string) => {
  currencyTouched.value = true
  values.currency = currency.trim().toUpperCase() || null
}

const onPicked = (result: { date: dayjs.Dayjs }) => {
  values.date = result.date.format(DATE_FORMAT)
  pickerOpen.value = false
}

// ── Saving ──

const close = () => {
  if (closed) return
  closed = true
  emit('close')
}

const onDialogClosed = () => close()

const write = async (): Promise<string | null> => {
  if (saving.value) return null
  saving.value = true
  try {
    const path = await saveTransactionForm({ ...values, groups: [...values.groups] }, editing.value)
    if (!path) new Notice('Could not save the transaction.')
    else emit('saved', path)
    return path
  } finally {
    saving.value = false
  }
}

const save = async () => {
  if (await write()) close()
}

/** Saves, and starts the next one on the same day between the same accounts. */
const saveAndNext = async () => {
  const path = await write()
  if (!path) return
  const amount =
    values.amount != null ? ` ${formatAmount(values.amount)} ${values.currency ?? ''}` : ''
  lastSaved.value = `${values.title.trim() || 'Transaction'}${amount}`.trim()
  editing.value = undefined
  values.title = ''
  values.description = ''
  values.amount = null
  values.foreignAmount = null
  values.category = null
  titleInput.value?.$el?.focus()
}

const openAsNote = async () => {
  const path = await write()
  if (!path) return
  close()
  await openFile(path)
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void save()
  }
}

onMounted(() => {
  if (!props.path) titleInput.value?.$el?.focus()
})
</script>

<style lang="scss">
.abele-transaction-form__money {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);

  > .abele-amount-field {
    flex: 1 1 auto;
  }
}

.abele-transaction-form__currency {
  flex: 0 0 6em;
  width: 6em;
  text-transform: uppercase;
}

.abele-transaction-form__rate-unit {
  flex: 0 0 auto;
  line-height: var(--input-height);
  color: var(--text-muted);
  white-space: nowrap;
}

.abele-transaction-form__context,
.abele-transaction-form__saved {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
