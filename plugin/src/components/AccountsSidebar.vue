<template>
  <SidebarPanel inset class="abele-accounts-sidebar">
    <!-- The pane's head as every list pane's; what it shows and in what order is a menu, as
         Obsidian's file list keeps its sort. -->
    <ListSectionHeader class-prefix="abele-accounts-sidebar" text="Accounts" :count="accountCount">
      <template #actions>
        <ObsidianIcon
          icon="sliders-horizontal"
          aria-haspopup="menu"
          label="What the list shows and its order"
          @click="optionsMenu"
        />
      </template>
    </ListSectionHeader>

    <!-- A group as a heading with its total at the end; an account as a row with its balance. -->
    <section
      v-for="group in groups"
      :key="group.type ?? 'all'"
      class="abele-accounts-sidebar__group"
    >
      <GroupHeading v-if="group.label" :label="group.label">
        <span v-for="t in group.totals" :key="t.currency"
          >{{ formatAmount(t.amount) }}
          <span class="abele-accounts-sidebar__currency">{{ t.currency }}</span></span
        >
      </GroupHeading>
      <EntryRow
        v-for="row in group.rows"
        :key="row.path"
        class="abele-accounts-sidebar__row"
        role="link"
        tabindex="0"
        @click="openRow(row)"
        @keydown.enter.self="openRow(row)"
      >
        <span
          class="abele-accounts-sidebar__name"
          :class="{ 'abele-accounts-sidebar__name_excluded': row.excluded }"
          >{{ row.name }}</span
        >
        <template #codes>
          <span
            class="abele-accounts-sidebar__amount"
            :class="{ 'abele-accounts-sidebar__amount_negative': row.balance < 0 }"
            >{{ formatAmount(row.balance) }}
            <span class="abele-accounts-sidebar__currency">{{ row.currency }}</span></span
          >
        </template>
      </EntryRow>
    </section>

    <!-- No accounts at all is a whole empty pane that says how one comes to be; none matching
         the options is one quiet line. -->
    <EmptyState
      v-if="!groups.length && !accountsList?.accounts.size"
      icon="landmark"
      title="No accounts yet"
      text="A note with type: account shows here with its balance."
    />
    <EmptyState v-else-if="!groups.length" :text="emptyText" />
  </SidebarPanel>
</template>

<script setup lang="ts">
import { computed, reactive, toRaw, toRef, unref } from 'vue'
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
import SidebarPanel from './obsidian/SidebarPanel.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import GroupHeading from './obsidian/GroupHeading.vue'
import EntryRow from './obsidian/EntryRow.vue'
import { Menu } from 'obsidian'
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

const accountCount = computed(() => groups.value.reduce((n, g) => n + g.rows.length, 0))

/** What the list shows and in what order, as Obsidian's own menus say it: ticks and headings. */
function optionsMenu(event: MouseEvent) {
  const menu = new Menu()
  const label = (title: string, section: string) =>
    menu.addItem((i) => i.setTitle(title).setIsLabel(true).setSection(section))
  const choice = (title: string, on: boolean, section: string, run: () => void) =>
    menu.addItem((i) => i.setTitle(title).setChecked(on).setSection(section).onClick(run))

  label('Order', 'order')
  for (const o of sortOptions)
    choice(o.display, options.sort === o.value, 'order', () =>
      update({ sort: o.value as AccountsSort })
    )
  if (currencyOptions.value.length > 2) {
    label('Currency', 'currency')
    for (const c of currencyOptions.value)
      choice(c.display, (options.currency || ALL) === c.value, 'currency', () =>
        update({ currency: c.value === ALL ? '' : c.value })
      )
  }
  label('Show', 'show')
  for (const type of ACCOUNT_TYPE_ORDER)
    choice(ACCOUNT_TYPE_LABELS[type], options.types.includes(type), 'show', () => toggleType(type))
  choice('Empty accounts', !options.hideZero, 'show', () => update({ hideZero: !options.hideZero }))
  choice('Accounts left out of totals', options.showExcluded, 'show', () =>
    update({ showExcluded: !options.showExcluded })
  )
  choice('Group by type', options.groupByType, 'group', () =>
    update({ groupByType: !options.groupByType })
  )
  menu.showAtMouseEvent(event)
}

function openRow(row: AccountRow) {
  void openFile(row.path)
}

const emptyText = computed(() =>
  accountsList.value?.accounts.size
    ? 'No accounts match these options.'
    : 'No accounts yet. A note with type: account appears here.'
)
</script>

<style lang="scss">
.abele-accounts-sidebar__group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);

  & + & {
    margin-top: var(--size-4-4);
  }
}

.abele-accounts-sidebar__amount {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
}

.abele-accounts-sidebar__amount_negative {
  color: var(--text-error);
}

.abele-accounts-sidebar__currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
}

.abele-accounts-sidebar__name_excluded {
  color: var(--text-muted);
}
</style>
