<template>
  <div class="abele-logs-list">
    <div class="abele-logs-list__header">
      <div class="abele-logs-list__header-text">Logs</div>
    </div>
    <div class="abele-logs-list__logs">
      <LogView
        v-for="log in sortedLogs"
        :key="log.filePath"
        class="abele-logs-list__note"
        :log="log"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Log } from '@/entities/Log'
import LogView from './Log.vue'
import { computed } from 'vue'

const props = defineProps<{
  logs: Log[]
}>()

const sortedLogs = computed(() => {
  return [...props.logs].sort((a, b) => {
    return b.createdAt?.isBefore(a.createdAt) ? -1 : 1
  })
})
</script>

<style lang="scss">
.abele-logs-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  font-weight: bold;
  margin-bottom: var(--p-spacing);
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
