<template>
  <li v-for="(event, i) in chunk.events" :key="chunk.first + i" :data-activity-id="chunk.first + i">
    <span class="abele-sync-window__time">{{ when(event) }}</span>
    <span>{{ event.text }}</span>
  </li>
</template>
<script setup lang="ts">
import type { ActivityChunk, ConnectionEvent } from '@/sync/activityHistory'
import { activityTime } from '@/sync/activityTime'
defineProps<{ chunk: ActivityChunk }>()
const times = new WeakMap<ConnectionEvent, string>()
function when(event: ConnectionEvent): string {
  let time = times.get(event)
  if (time === undefined) {
    time = activityTime(event.at)
    times.set(event, time)
  }
  return time
}
</script>
