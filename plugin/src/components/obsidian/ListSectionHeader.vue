<template>
  <div class="abele-list-section-header" :class="classPrefix + '__header'">
    <div :class="classPrefix + '__header-left'">
      <FoldHeading
        :class="classPrefix + '__header-text'"
        :text="text"
        :count="count"
        :collapsible="fold.enabled"
        :collapsed="fold.collapsed.value"
        @toggle="fold.toggle"
      />
      <slot name="leading" />
    </div>
    <span v-if="total !== undefined" class="abele-list-section-header__count"
      >{{ count }} of {{ total }}</span
    >
    <span v-if="loading" class="abele-list-section-header__count" role="status">Loading…</span>
    <div
      v-if="!fold.collapsed.value || actionsWhenCollapsed"
      :class="groupActions ? classPrefix + '__header-right' : undefined"
      class="abele-list-section-header__actions"
    >
      <Icon
        v-if="search && !fold.collapsed.value"
        :class="classPrefix + '__search-toggle'"
        icon="search"
        :active="search.open.value"
        :tooltip="search.open.value ? 'Close the search' : searchTooltip"
        @click="search.toggle"
      />
      <slot name="actions" />
    </div>
  </div>
  <Search
    v-if="search && !fold.collapsed.value && search.open.value"
    v-model="search.query.value"
    :class="classPrefix + '__search'"
    :placeholder="placeholder"
    autofocus
    @keydown.escape.stop.prevent="search.close"
  />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import FoldHeading from './FoldHeading.vue'
import Icon from './Icon.vue'
import Search from './Search.vue'
import type { Fold } from '@/composables/useFooterFold'
import type { ListSearch } from '@/composables/useListSearch'
defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    classPrefix?: string
    text: string
    count: number
    fold?: Fold
    total?: number
    loading?: boolean
    search?: Pick<ListSearch<object>, 'open' | 'query' | 'toggle' | 'close'>
    searchTooltip?: string
    placeholder?: string
    groupActions?: boolean
    actionsWhenCollapsed?: boolean
  }>(),
  { classPrefix: 'abele-list-section' }
)
const plainFold: Fold = { enabled: false, collapsed: ref(false), toggle: () => {} }
const fold = computed(() => props.fold ?? plainFold)
</script>
<style>
.abele-list-section-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-block: var(--size-4-3) var(--size-4-2);
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
}
.abele-list-section-header__count {
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  color: var(--text-muted);
}
.abele-list-section-header__actions {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin-inline-start: auto;
}
</style>
