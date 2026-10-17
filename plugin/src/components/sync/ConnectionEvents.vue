<template>
  <ol class="abele-sync-window__events">
    <li v-for="(event, i) in newestFirst" :key="events.length - 1 - i">
      <span class="abele-sync-window__time">{{ when(event) }}</span>
      <span>{{ event.text }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
/**
 * The connection's recent activity, newest first. A component of its own so that progress
 * ticks of the window around it do not touch these rows: it renders again only when the
 * list itself is a different list.
 */
import { computed } from 'vue'

type ConnectionEvent = { at: number; text: string }
const props = defineProps<{ events: readonly ConnectionEvent[] }>()

const newestFirst = computed(() => [...props.events].reverse())

/** Each event's time is formatted once, not on every render of the list. */
const times = new WeakMap<ConnectionEvent, string>()
function when(event: ConnectionEvent): string {
  let time = times.get(event)
  if (time === undefined) {
    time = new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    times.set(event, time)
  }
  return time
}
</script>
