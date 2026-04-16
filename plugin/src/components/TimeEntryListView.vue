<template>
  <div class="abele-time-entries-list">
    <div class="abele-time-entries-list__header">
      <div class="abele-time-entries-list__header-text">Time Entries</div>
    </div>
    <div v-if="sorted.length" class="abele-time-entries-list__items">
      <TimeEntryItem v-for="entry in sorted" :key="entry.id" :entry="entry" />
    </div>
    <div v-else class="abele-time-entries-list__empty">No time entries.</div>
  </div>
</template>

<script setup lang="ts">
import { TimeEntry } from '@/entities/TimeEntry'
import TimeEntryItem from './TimeEntryItem.vue'
import { computed } from 'vue'

const props = defineProps<{
  timeEntries: TimeEntry[]
}>()

const sorted = computed(() => {
  return [...props.timeEntries].sort((a, b) => {
    const da = a.start ? a.start.valueOf() : 0
    const db = b.start ? b.start.valueOf() : 0
    return db - da
  })
})
</script>

<style lang="scss">
.abele-time-entries-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: var(--p-spacing);

  .abele-time-entries-list__header-text {
    font-weight: bold;
  }
}

.abele-time-entries-list__items {
  display: flex;
  flex-direction: column;
}

.abele-time-entries-list__empty {
  font-style: italic;
  color: var(--text-muted);
}
</style>
