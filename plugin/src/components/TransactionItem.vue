<template>
  <div v-if="transaction.transactionNotFound" class="abele-transaction-view">
    <em class="abele-transaction-view__content">Transaction not found</em>
  </div>
  <div v-else-if="transaction.loaded" ref="txEl" class="abele-transaction-view">
    <div class="abele-transaction-view__content">
      <div class="abele-transaction-view__main">
        <ObsidianMarkdown
          v-if="contentLoaded"
          :text="transaction.title ?? ''"
          :file-path="transaction.transactionPath"
          class="abele-transaction-view__title"
        />
        <span class="abele-transaction-view__amount">
          {{ formatAmount(transaction.amount ?? 0) }}
          <span class="abele-transaction-view__currency">{{ transaction.currency }}</span>
        </span>
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
        <span>{{ dateText }}</span>
      </div>
    </div>
    <ObsidianIcon
      v-if="transaction.description"
      :icon="showDescription ? 'chevron-up' : 'chevron-down'"
      @click.stop="toggleDescription"
    />
    <div class="abele-transaction-view__buttons abele-transaction-view__buttons_full">
      <ObsidianIcon icon="edit" @click.stop="edit" />
    </div>
    <div class="abele-transaction-view__buttons abele-transaction-view__buttons_small">
      <ObsidianIcon ref="menuButton" icon="edit" @click.stop="menu.open" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { Transaction } from '@/entities/Transaction'
import { computed, onMounted, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { openFile } from '@/helpers/vaultUtils'
import { useElementVisibility } from '@vueuse/core'
import Icon from './obsidian/Icon.vue'
import { Choice, useMenu } from '@/composables/useMenu'

const props = defineProps<{
  transaction: Transaction
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

const dateText = computed(() => {
  if (!props.transaction.date) return ''
  return props.transaction.date.format(DISPLAY_DATE_FORMAT)
})

const menuButton = ref<InstanceType<typeof Icon> | null>(null)

const menuChoices = computed<Choice[]>(() => {
  return [{ title: 'Edit', event: 'edit' }]
})

const handleMenuSelect = (event: string) => {
  if (event === 'edit') {
    edit()
  }
}

const menu = useMenu(menuButton, menuChoices, handleMenuSelect)

const edit = () => {
  openFile(props.transaction.transactionPath)
}

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

onMounted(() => {
  props.transaction.load()
})
</script>

<style lang="scss">
.abele-transaction-view {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
  margin-bottom: 0.25em;
  padding: 0.25em 0;

  p {
    margin: 0;
    word-break: break-word;
  }
}

.abele-transaction-view__buttons {
  align-items: flex-start;
  gap: 0.5em;

  &_full {
    display: flex;
  }

  &_small {
    display: none;
  }
}

@media (max-width: 600px) {
  .abele-transaction-view__buttons {
    &_full {
      display: none;
    }

    &_small {
      display: flex;
    }
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
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5em;
}

.abele-transaction-view__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.abele-transaction-view__amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
