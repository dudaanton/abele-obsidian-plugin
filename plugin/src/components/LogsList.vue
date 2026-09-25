<template>
  <div class="abele-logs-list">
    <div class="abele-logs-list__header">
      <div class="abele-logs-list__header-text">Logs</div>
      <ObsidianIcon
        class="abele-logs-list__search-toggle"
        icon="search"
        :active="search.open.value"
        :tooltip="search.open.value ? 'Close the search' : 'Search logs by name and text'"
        @click="search.toggle"
      />
    </div>
    <ObsidianSearch
      v-if="search.open.value"
      v-model="search.query.value"
      class="abele-logs-list__search"
      placeholder="Search logs…"
      autofocus
      @keydown.escape.stop.prevent="search.close"
    />
    <div ref="itemsEl" class="abele-logs-list__logs">
      <LogView
        v-for="log in visible"
        :key="log.filePath"
        class="abele-logs-list__note"
        :log="log"
      />
      <div v-if="hasMore" ref="sentinel" class="abele-logs-list__sentinel" />
    </div>
    <div v-if="!sortedLogs.length" class="abele-logs-list__no-logs">
      Nothing matches the search.
    </div>
  </div>
</template>

<script setup lang="ts">
import { Log } from '@/entities/Log'
import LogView from './Log.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianSearch from './obsidian/Search.vue'
import { computed, ref, watch } from 'vue'
import { usePagedList } from '@/composables/usePagedList'
import { logSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'

const props = defineProps<{
  logs: Log[]
}>()

const search = useListSearch(() => props.logs, logSearch)

const itemsEl = ref<HTMLElement | null>(null)
useSearchHighlight(itemsEl, search.terms)

const sortedLogs = computed(() => {
  return [...search.results.value].sort((a, b) => {
    return b.createdAt?.isBefore(a.createdAt) ? -1 : 1
  })
})

const { visible, hasMore, sentinel, reset } = usePagedList(() => sortedLogs.value)

// A new query is a different list; the window expanded over the old one means nothing here.
watch(search.terms, reset)
</script>

<style lang="scss">
.abele-logs-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: var(--p-spacing);
}

.abele-logs-list__header-text {
  font-weight: bold;
}

.abele-logs-list__search {
  margin-bottom: var(--p-spacing);
}

.abele-logs-list__no-logs {
  font-style: italic;
  color: var(--text-muted);
}

.abele-logs-list__sentinel {
  height: 1px;
}

.abele-logs-list__logs {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing));
  padding-left: calc(var(--icon-size) / 4);

  br {
    display: none;
  }
}
</style>
