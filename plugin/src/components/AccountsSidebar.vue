<template>
  <div class="abele-accounts-sidebar">
    <div class="abele-accounts-sidebar__header">
      <div class="abele-accounts-sidebar__title">Accounts</div>
      <ObsidianIcon
        icon="sliders-horizontal"
        :tooltip="optionsOpen ? 'Hide list options' : 'Choose what the list shows and its order'"
        :with-bg="optionsOpen"
        @click="optionsOpen = !optionsOpen"
      />
    </div>

    <div v-if="optionsOpen" class="abele-accounts-sidebar__options">
      <Setting name="Sort by">
        <Dropdown
          :options="sortOptions"
          :model-value="options.sort"
          @update:model-value="update({ sort: $event as AccountsSort })"
        />
      </Setting>
      <Setting name="Currency">
        <Dropdown
          :options="currencyOptions"
          :model-value="options.currency || ALL"
          @update:model-value="update({ currency: $event === ALL ? '' : $event })"
        />
      </Setting>
      <Setting name="Group by type">
        <Checkbox
          :is-enabled="options.groupByType"
          @toggle="update({ groupByType: !options.groupByType })"
        />
      </Setting>
      <Setting name="Hide empty accounts" desc="Accounts whose balance is zero.">
        <Checkbox
          :is-enabled="options.hideZero"
          @toggle="update({ hideZero: !options.hideZero })"
        />
      </Setting>
      <Setting
        name="Show accounts left out of totals"
        desc="Listed either way when shown, never counted in a total."
      >
        <Checkbox
          :is-enabled="options.showExcluded"
          @toggle="update({ showExcluded: !options.showExcluded })"
        />
      </Setting>
      <Setting v-for="type in ACCOUNT_TYPE_ORDER" :key="type" :name="ACCOUNT_TYPE_LABELS[type]">
        <Checkbox :is-enabled="options.types.includes(type)" @toggle="toggleType(type)" />
      </Setting>
    </div>

    <Section
      v-for="group in groups"
      :key="group.type ?? 'all'"
      :title="group.label || undefined"
      :desc="totalsText(group.totals)"
      class="abele-accounts-sidebar__group"
    >
      <Table :columns="columns" :rows="tableRows(group.rows)" clickable @row-click="openRow">
        <template #cell="{ row, column }">
          <div
            v-if="column.key === 'balance'"
            class="abele-accounts-sidebar__amount"
            :class="{ 'abele-accounts-sidebar__amount_negative': (row.amount as number) < 0 }"
          >
            {{ row.balance }}
            <span class="abele-accounts-sidebar__currency">{{ row.currency }}</span>
          </div>
          <div
            v-else
            class="abele-accounts-sidebar__name"
            :class="{ 'abele-accounts-sidebar__name_excluded': row.excluded }"
          >
            {{ row.name }}
          </div>
        </template>
      </Table>
    </Section>

    <EmptyState v-if="!groups.length" :text="emptyText" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRaw, toRef, unref } from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AccountsList } from '@/entities/AccountsList'
import type { BalanceIndex } from '@/entities/BalanceIndex'
import type { AccountType } from '@/entities/Account'
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  accountRows,
  groupAccountRows,
  normalizeAccountsList,
  type AccountGroup,
  type AccountRow,
  type AccountsListSettings,
  type AccountsSort,
} from '@/helpers/accountRows'
import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { formatAmount } from '@/helpers/moneyFormat'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { openFile } from '@/helpers/vaultUtils'
import ObsidianIcon from './obsidian/Icon.vue'
import Setting from './obsidian/Setting.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Section from './obsidian/Section.vue'
import Table from './obsidian/Table.vue'
import EmptyState from './obsidian/EmptyState.vue'

const props = withDefaults(
  defineProps<{
    /** Whether the panel can be seen; nothing recalculates while it cannot. */
    active?: boolean
  }>(),
  { active: true }
)

const ALL = '*'

const store = GlobalStore.getInstance()
const config = AbeleConfig.getInstance()

const optionsOpen = ref(false)
const options = reactive<AccountsListSettings>(normalizeAccountsList(config.accountsList))

const sortOptions = [
  { value: 'size', display: 'Size of balance' },
  { value: 'balance', display: 'Balance, highest first' },
  { value: 'name', display: 'Name' },
]

let saveTimer: number | null = null
function update(change: Partial<AccountsListSettings>) {
  Object.assign(options, change)
  config.accountsList = normalizeAccountsList(toRaw(options))
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void config.saveSettings()
  }, 500)
}

function toggleType(type: AccountType) {
  const types = options.types.includes(type)
    ? options.types.filter((t) => t !== type)
    : [...options.types, type]
  update({ types })
}

const accountsList = computed(() => unref(store.accountsList) as AccountsList | null)

const currencyOptions = computed(() => {
  const currencies = new Set<string>()
  for (const account of accountsList.value?.accounts.values() ?? []) {
    if (account.currency) currencies.add(account.currency)
  }
  if (options.currency) currencies.add(options.currency)
  return [
    { value: ALL, display: 'All currencies' },
    ...[...currencies].sort().map((c) => ({ value: c, display: c })),
  ]
})

const groups = pausedWhileHidden(toRef(props, 'active'), (): AccountGroup[] => {
  const al = accountsList.value
  const bi = toRaw(unref(store.balanceIndex)) as BalanceIndex | null
  if (!al || !bi) return []
  void bi.version.value

  const today = dayjs()
  const { app } = store
  const rows = accountRows(
    al.accounts,
    {
      balance: (path) => bi.getBalanceAtDate(path, today),
      currencies: (path) => bi.getCurrenciesForAccount(path),
      balanceIn: (path, currency) => bi.getBalanceAtDateByCurrency(path, today, currency),
      resolve: (wikilink) => {
        const linkPath = wikilinkToPath(wikilink)
        return linkPath
          ? (app.metadataCache.getFirstLinkpathDest(linkPath, '')?.path ?? null)
          : null
      },
    },
    { ...options, types: [...options.types] }
  )
  return groupAccountRows(rows, options.groupByType)
})

const columns = [
  { key: 'name', label: 'Account' },
  { key: 'balance', label: 'Balance' },
]

function tableRows(rows: AccountRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    path: row.path,
    name: row.name,
    balance: formatAmount(row.balance),
    amount: row.balance,
    currency: row.currency,
    excluded: row.excluded,
  }))
}

function totalsText(totals: AccountGroup['totals']): string {
  return totals
    .map(({ currency, amount }) => `${formatAmount(amount)} ${currency}`.trim())
    .join(' · ')
}

function openRow(row: Record<string, unknown>) {
  void openFile(row.path as string)
}

const emptyText = computed(() =>
  accountsList.value?.accounts.size
    ? 'No accounts match these options.'
    : 'No accounts yet. A note with type: account appears here.'
)
</script>

<style lang="scss">
.abele-accounts-sidebar {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  background-color: var(--background-primary);
  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));
}

@media (max-width: 600px) {
  .abele-accounts-sidebar {
    padding: var(--size-4-4);
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}

.abele-accounts-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--p-spacing);
}

.abele-accounts-sidebar__title {
  font-weight: var(--font-bold);
}

.abele-accounts-sidebar__options {
  margin-bottom: var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-accounts-sidebar__group {
  margin-top: var(--size-4-6);
}

.abele-accounts-sidebar__amount {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.abele-accounts-sidebar__amount_negative {
  color: var(--text-error);
}

.abele-accounts-sidebar__currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-accounts-sidebar__name {
  overflow-wrap: anywhere;
}

.abele-accounts-sidebar__name_excluded {
  color: var(--text-muted);
}
</style>
