<template>
  <div v-if="transaction.transactionNotFound" class="abele-transaction-view">
    <em class="abele-transaction-view__content">Transaction not found</em>
  </div>
  <div
    v-else-if="transaction.loaded"
    ref="txEl"
    class="abele-transaction-view"
    @click="onCardClick"
    @contextmenu.prevent="onContextMenu"
  >
    <div class="abele-transaction-view__content">
      <div class="abele-transaction-view__main">
        <ObsidianMarkdown
          v-if="contentLoaded"
          :text="transaction.title ?? ''"
          :file-path="transaction.transactionPath"
          class="abele-transaction-view__title"
        />
        <ObsidianIcon
          v-if="transaction.description"
          :icon="showDescription ? 'chevron-up' : 'chevron-down'"
          @click.stop="toggleDescription"
        />
      </div>
      <ObsidianMarkdown
        v-if="transaction.description && showDescription && contentLoaded"
        :text="transaction.description"
        :file-path="transaction.transactionPath"
        class="abele-transaction-view__description"
      />
      <div class="abele-transaction-view__info">
        <span v-if="transaction.from || transaction.to" class="abele-transaction-view__accounts">
          <ObsidianMarkdown
            v-if="transaction.from && contentLoaded"
            :text="transaction.from"
            :file-path="transaction.transactionPath"
            class="abele-transaction-view__link"
          />
          <span v-if="transaction.from && transaction.to"> → </span>
          <ObsidianMarkdown
            v-if="transaction.to && contentLoaded"
            :text="transaction.to"
            :file-path="transaction.transactionPath"
            class="abele-transaction-view__link"
          />
        </span>
      </div>
    </div>
    <span class="abele-transaction-view__amount" :class="amountClass">
      {{ txType === 'expense' ? '-' : '' }}{{ formatAmount(transaction.amount ?? 0) }}
      <span class="abele-transaction-view__currency">{{ transaction.currency }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { Transaction } from '@/entities/Transaction'
import { computed, onMounted, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
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

const txEl = ref(null)
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
      .onClick(() => {
        if (confirm('Are you sure you want to delete this transaction?')) {
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
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 0.25em;
  padding: 0.25em 0;
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  p {
    margin: 0;
    word-break: break-word;
  }
}

.abele-transaction-view__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
  min-width: 0;
}

.abele-transaction-view__main {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}

/*
 * Wide enough for its text and no wider. It used to take the whole row, which put the chevron
 * that expands the note against the right edge — a hand's breadth from the title it belongs to
 * and level with nothing, since the amount beside it is centred on the row rather than on the
 * first line. Only a title long enough to fill the row still pushes it there, and then it is
 * where the text ends anyway.
 */
.abele-transaction-view__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.abele-transaction-view__amount {
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

.abele-transaction-view__info {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 0.25em;
  font-size: 0.85em;
  gap: 0.25em;
  color: var(--text-muted);
}

.abele-transaction-view__accounts {
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
}

.abele-transaction-view__link {
  display: inline;

  p {
    display: inline;
  }

  .internal-link {
    color: var(--text-accent);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
