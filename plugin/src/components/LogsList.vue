<template>
  <div class="abele-logs-list" data-abele-anchor="section:logs">
    <ListSectionHeader
      class-prefix="abele-logs-list"
      text="Logs"
      :count="logs.length"
      :fold="fold"
      :search="calendar ? undefined : search"
      search-tooltip="Search logs by name and text"
      placeholder="Search logs…"
    >
      <!-- List or month, remembered for this note: a log read by its days opens on them. -->
      <template #actions>
        <Icon
          :icon="calendar ? 'list' : 'calendar-days'"
          class="abele-logs-list__view"
          :tooltip="calendar ? 'Show as a list' : 'Show as a calendar'"
          @click="setCalendar(!calendar)"
        />
      </template>
    </ListSectionHeader>
    <LogsCalendar v-if="calendar && !fold.collapsed.value" :logs="logs" />
    <template v-else-if="!fold.collapsed.value">
      <div ref="itemsEl" class="abele-logs-list__logs">
        <LogView
          v-for="log in visible"
          :key="log.filePath"
          :data-abele-anchor="'log:' + log.filePath"
          class="abele-logs-list__note"
          :log="log"
        />
        <div v-if="hasMore" ref="sentinel" class="abele-logs-list__sentinel" />
      </div>
      <div v-if="!sortedLogs.length" class="abele-logs-list__no-logs">
        Nothing matches the search.
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Log } from '@/entities/Log'
import LogView from './Log.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import Icon from './obsidian/Icon.vue'
import LogsCalendar from './LogsCalendar.vue'
import { computed, ref, watch } from 'vue'
import { usePagedList } from '@/composables/usePagedList'
import { useFooterLogsView, useFooterPages } from '@/composables/useFooterView'
import { logSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'
import { useFooterFold } from '@/composables/useFooterFold'

const props = defineProps<{
  logs: Log[]
}>()

const fold = useFooterFold('logs')

const view = useFooterLogsView()
const calendar = ref(view.initial)
const setCalendar = (on: boolean) => {
  calendar.value = on
  view.record(on)
}

const search = useListSearch(() => props.logs, logSearch)

const itemsEl = ref<HTMLElement | null>(null)
useSearchHighlight(itemsEl, search.terms)

const sortedLogs = computed(() => {
  return [...search.results.value].sort((a, b) => {
    return b.createdAt?.isBefore(a.createdAt) ? -1 : 1
  })
})

const { visible, hasMore, sentinel, followSearch } = usePagedList(
  () => sortedLogs.value,
  undefined,
  useFooterPages('logs')
)

// A new query is a different list; the window expanded over the old one means nothing here.
// Closing the search gives back the pages drawn before it.
watch(search.terms, followSearch)
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

  br {
    display: none;
  }
}
</style>
