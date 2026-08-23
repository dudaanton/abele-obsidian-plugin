<template>
  <div class="abele-logs-list">
    <div class="abele-logs-list__header">
      <div class="abele-logs-list__header-text">Logs</div>
    </div>
    <div class="abele-logs-list__logs">
      <LogView
        v-for="log in visible"
        :key="log.filePath"
        class="abele-logs-list__note"
        :log="log"
      />
      <div v-if="hasMore" ref="sentinel" class="abele-logs-list__sentinel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Log } from '@/entities/Log'
import LogView from './Log.vue'
import { computed } from 'vue'
import { usePagedList } from '@/composables/usePagedList'

const props = defineProps<{
  logs: Log[]
}>()

const sortedLogs = computed(() => {
  return [...props.logs].sort((a, b) => {
    return b.createdAt?.isBefore(a.createdAt) ? -1 : 1
  })
})

const { visible, hasMore, sentinel } = usePagedList(() => sortedLogs.value)
</script>

<style lang="scss">
.abele-logs-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  font-weight: bold;
  margin-bottom: var(--p-spacing);
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
