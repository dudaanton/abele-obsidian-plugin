<template>
  <div v-if="transaction.transactionNotFound" class="abele-transaction-view">
    <em class="abele-transaction-view__content">Transaction not found</em>
  </div>
  <EntryRow
    v-else-if="transaction.loaded"
    ref="rowEl"
    class="abele-transaction-view"
    role="link"
    tabindex="0"
    :more="transaction.description ? showDescription : undefined"
    more-label="note"
    @update:more="toggleDescription"
    @click="onCardClick"
    @keydown.enter.self="openFile(transaction.transactionPath)"
    @contextmenu.prevent="onContextMenu"
  >
    <ObsidianMarkdown
      v-if="contentLoaded"
      trusted
      :text="transaction.title ?? ''"
      :file-path="transaction.transactionPath"
      class="abele-transaction-view__title"
    />
    <!-- The amount on the name's line, in the column the day's total stands in. -->
    <template #codes>
      <span class="abele-transaction-view__amount" :class="amountClass"
        >{{ txType === 'expense' ? '-' : '' }}{{ formatAmount(transaction.amount ?? 0) }}
        <span class="abele-transaction-view__currency">{{ transaction.currency }}</span></span
      >
    </template>
    <template v-if="transaction.from || transaction.to" #meta>
      <span class="abele-transaction-view__accounts">
        <ObsidianMarkdown
          v-if="transaction.from && contentLoaded"
          trusted
          :text="transaction.from"
          :file-path="transaction.transactionPath"
          class="abele-transaction-view__link"
        />
        <span v-if="transaction.from && transaction.to"> → </span>
        <ObsidianMarkdown
          v-if="transaction.to && contentLoaded"
          trusted
          :text="transaction.to"
          :file-path="transaction.transactionPath"
          class="abele-transaction-view__link"
        />
      </span>
    </template>
    <template v-if="transaction.description && showDescription && contentLoaded" #detail>
      <ObsidianMarkdown
        trusted
        :text="transaction.description"
        :file-path="transaction.transactionPath"
        class="abele-transaction-view__description"
      />
    </template>
  </EntryRow>
</template>

<script setup lang="ts">
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { Transaction } from '@/entities/Transaction'
import { computed, onMounted, ref, watch } from 'vue'
import EntryRow from './obsidian/EntryRow.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { openFile } from '@/helpers/vaultUtils'
import { useElementVisibility } from '@vueuse/core'
import { Menu } from 'obsidian'
import { formatAmount } from '@/helpers/moneyFormat'

export type TransactionType = 'income' | 'expense' | 'transfer'

const props = defineProps<{
  transaction: Transaction
  txType: TransactionType
}>()

const rowEl = ref<{ $el: HTMLElement } | null>(null)
const txEl = computed(() => rowEl.value?.$el ?? null)
const isVisible = useElementVisibility(txEl)
const contentLoaded = ref(false)

watch(
  isVisible,
  () => {
    if (isVisible.value && !contentLoaded.value) {
      props.transaction.loadContent()
      contentLoaded.value = true
    }
  },
  {
    immediate: true,
  }
)

const showDescription = ref(false)
const toggleDescription = () => {
  showDescription.value = !showDescription.value
}

const amountClass = computed(() => {
  return `abele-transaction-view__amount--${props.txType}`
})

const onCardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('a.internal-link') || target.closest('.abele-obsidian-icon')) return
  openFile(props.transaction.transactionPath)
}

const onContextMenu = (e: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item
      .setTitle('Delete')
      .setIcon('trash')
      .onClick(async () => {
        if (
          await confirmAction(GlobalStore.getInstance().app, {
            title: 'Delete transaction',
            message: 'Are you sure you want to delete this transaction?',
          })
        ) {
          props.transaction.remove()
        }
      })
  })
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}

onMounted(() => {
  props.transaction.load()
})
</script>

<style lang="scss">
.abele-transaction-view {
  p {
    margin: 0;
    word-break: break-word;
  }
}

.abele-transaction-view__title {
  display: block;
}

.abele-transaction-view__amount {
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &--income {
    color: var(--text-success);
  }

  &--expense {
    color: var(--text-error);
  }

  &--transfer {
    color: var(--color-purple);
  }
}

.abele-transaction-view__currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-weight: normal;
}

.abele-transaction-view__description {
  p {
    color: var(--text-muted);
  }
}

.abele-transaction-view__accounts {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--size-2-1);

  // A long pair wraps between the names, never inside one.
  p {
    word-break: normal;
  }
}

.abele-transaction-view__link {
  display: inline;

  p {
    display: inline;
  }

  // The accounts are where the money went, read in passing: muted, accent only under the pointer.
  .internal-link {
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      color: var(--text-accent);
      text-decoration: underline;
    }
  }
}
</style>
