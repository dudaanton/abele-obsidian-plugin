<template>
  <div :class="classPrefix + '__header'">
    <div v-if="$slots.leading" :class="classPrefix + '__header-left'">
      <FoldHeading
        :class="classPrefix + '__header-text'"
        :text="text"
        :count="fold.enabled ? count : undefined"
        :collapsible="fold.enabled"
        :collapsed="fold.collapsed.value"
        @toggle="fold.toggle"
      />
      <slot name="leading" />
    </div>
    <FoldHeading
      v-else
      :class="classPrefix + '__header-text'"
      :text="text"
      :count="fold.enabled ? count : undefined"
      :collapsible="fold.enabled"
      :collapsed="fold.collapsed.value"
      @toggle="fold.toggle"
    />
    <div v-if="groupActions && !fold.collapsed.value" :class="classPrefix + '__header-right'">
      <Icon
        v-if="search"
        :class="classPrefix + '__search-toggle'"
        icon="search"
        :active="search.open.value"
        :tooltip="search.open.value ? 'Close the search' : searchTooltip"
        @click="search.toggle"
      />
      <slot name="actions" />
    </div>
    <template v-else-if="!fold.collapsed.value || actionsWhenCollapsed">
      <Icon
        v-if="search && !fold.collapsed.value"
        :class="classPrefix + '__search-toggle'"
        icon="search"
        :active="search.open.value"
        :tooltip="search.open.value ? 'Close the search' : searchTooltip"
        @click="search.toggle"
      />
      <slot name="actions" />
    </template>
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
import FoldHeading from './FoldHeading.vue'
import Icon from './Icon.vue'
import Search from './Search.vue'
import type { Fold } from '@/composables/useFooterFold'
import type { ListSearch } from '@/composables/useListSearch'

defineOptions({ inheritAttrs: false })
defineProps<{
  classPrefix: string
  text: string
  count: number
  fold: Fold
  search?: Pick<ListSearch<object>, 'open' | 'query' | 'toggle' | 'close'>
  searchTooltip?: string
  placeholder?: string
  groupActions?: boolean
  actionsWhenCollapsed?: boolean
}>()
</script>
