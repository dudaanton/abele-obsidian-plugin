<template>
  <ol ref="list" class="abele-sync-window__events">
    <li v-for="event in events" :key="keyOf(event)">
      <span class="abele-sync-window__time">{{ when(event) }}</span>
      <span>{{ event.text }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
/**
 * The connection's recent activity, in time order. A component of its own so that progress
 * ticks of the window around it do not touch these rows: it renders again only when the
 * list itself is a different list.
 */
import { nextTick, onMounted, ref, watch } from 'vue'

type ConnectionEvent = { at: number; text: string }
const props = defineProps<{ events: readonly ConnectionEvent[] }>()

const list = ref<HTMLOListElement>()
const keys = new WeakMap<ConnectionEvent, number>()
let nextKey = 0
function keyOf(event: ConnectionEvent): number {
  let key = keys.get(event)
  if (key === undefined) keys.set(event, (key = nextKey++))
  return key
}

const scroller = () => list.value?.closest<HTMLElement>('.abele-modal__body')
onMounted(() => {
  const parent = scroller()
  if (parent) parent.scrollTop = parent.scrollHeight
})
watch(
  () => props.events,
  async () => {
    const parent = scroller()
    const follow = parent && parent.scrollHeight - parent.scrollTop - parent.clientHeight <= 4
    await nextTick()
    if (follow && parent.isConnected) parent.scrollTop = parent.scrollHeight
  }
)

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
